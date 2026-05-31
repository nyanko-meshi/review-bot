import crypto from 'crypto';
import { handleMessage } from '../lib/messageHandler.js';

function verifySignature(rawBody, signature) {
  const hash = crypto
    .createHmac('SHA256', process.env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  return hash === signature;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['x-line-signature'];
  const rawBody = JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const events = req.body.events ?? [];
  await Promise.all(
    events
      .filter(e => e.type === 'message' && e.message.type === 'text')
      .map(e => handleMessage(e).catch(err => console.error('handler error:', err)))
  );

  res.status(200).end();
}
