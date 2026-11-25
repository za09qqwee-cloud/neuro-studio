
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return res.status(500).json({ ok: false });
  }

  try {
    const { name, contact, tariff, message } = req.body || {};

    if (typeof name !== 'string' ||
        typeof contact !== 'string' ||
        !name.trim() || !contact.trim()) {
      return res.status(400).json({ ok: false });
    }

    const text = [
      'НОВАЯ ЗАЯВКА | NEURO STUDIO',
      '',
      `Имя: ${name.slice(0, 100)}`,
      `Контакт: ${contact.slice(0, 200)}`,
      `Тариф: ${String(tariff || 'Не выбран').slice(0, 100)}`,
      `Комментарий: ${String(message || 'Нет').slice(0, 1000)}`
    ].join('\n');

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chatId,
          text
        })
      }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return res.status(502).json({ ok: false });
    }

    return res.status(200).json({ ok: true });

  } catch {
    return res.status(500).json({ ok: false });
  }
};
