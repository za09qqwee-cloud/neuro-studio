const { isIP } = require('node:net');

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;
const MAX_CLIENTS = 2048;
const MAX_BODY_BYTES = 8192;
const tariffs = new Set(['START', 'BUSINESS', 'PREMIUM']);
const clients = new Map();

function consumeAttempt(ip, now) {
  // Fixed windows expire in insertion order. Bound memory without evicting live limits.
  for (const [key, entry] of clients) {
    if (entry.expiresAt > now) break;
    clients.delete(key);
  }

  let entry = clients.get(ip);
  if (!entry) {
    if (clients.size >= MAX_CLIENTS) {
      return Math.ceil((clients.values().next().value.expiresAt - now) / 1000);
    }
    entry = { count: 0, expiresAt: now + WINDOW_MS };
    clients.set(ip, entry);
  }
  if (entry.count >= MAX_REQUESTS) return Math.ceil((entry.expiresAt - now) / 1000);
  entry.count++;
  return 0;
}

module.exports = async (req, res) => {
  const fail = (status) => res.status(status).json({ ok: false });
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(405);
  }

  const { headers } = req;
  if (headers['sec-fetch-site'] === 'cross-site') return fail(403);

  const mediaType = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return fail(415);
  if (Number(headers['content-length']) > MAX_BODY_BYTES) return fail(413);

  let body;
  try {
    body = req.body;
    const serialized = typeof body === 'string' ? body : JSON.stringify(body ?? null);
    if (Buffer.byteLength(serialized) > MAX_BODY_BYTES) return fail(413);
    if (typeof body === 'string') body = JSON.parse(body);
  } catch {
    return fail(400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400);

  const { name, contact, tariff, message = '', website = '' } = body;
  if (typeof website !== 'string') return fail(400);
  if (website !== '') return res.status(200).json({ ok: true });

  if (typeof name !== 'string' || !name.trim() || name.length > 100 ||
      typeof contact !== 'string' || !contact.trim() || contact.length > 200 ||
      !tariffs.has(tariff) || typeof message !== 'string' || message.length > 1000) {
    return fail(400);
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return fail(500);

  // Vercel supplies this IP header. Outside Vercel, use the socket peer.
  const forwarded = headers['x-vercel-forwarded-for'];
  const ip = process.env.VERCEL && typeof forwarded === 'string' && isIP(forwarded)
    ? forwarded
    : req.socket?.remoteAddress || 'unknown';
  const retryAfter = consumeAttempt(ip, Date.now());
  if (retryAfter) {
    res.setHeader('Retry-After', String(retryAfter));
    return fail(429);
  }

  const singleLine = (value) => value.trim().replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');
  const text = [
    'НОВАЯ ЗАЯВКА | NEURO STUDIO',
    '',
    `Имя: ${singleLine(name)}`,
    `Контакт: ${singleLine(contact)}`,
    `Тариф: ${tariff}`,
    `Комментарий: ${message.trim() || 'Нет'}`
  ].join('\n');

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          link_preview_options: { is_disabled: true }
        })
      }
    );
    if (!response.ok || (await response.json())?.ok !== true) return fail(502);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return fail(error?.name === 'TimeoutError' ? 504 : 502);
  }
};
