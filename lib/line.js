const BASE = 'https://api.line.me/v2/bot/message';
const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
});

export async function replyMessage(replyToken, messages) {
  const res = await fetch(`${BASE}/reply`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) console.error('LINE reply error:', await res.text());
}

export async function pushMessage(userId, messages) {
  const res = await fetch(`${BASE}/push`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ to: userId, messages }),
  });
  if (!res.ok) console.error('LINE push error:', await res.text());
}

export function textMessage(text) {
  return { type: 'text', text };
}

export function quickReply(text, items) {
  return {
    type: 'text',
    text,
    quickReply: {
      items: items.map(({ label, text: data }) => ({
        type: 'action',
        action: { type: 'message', label, text: data },
      })),
    },
  };
}
