require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WABA_VERIFY_TOKEN || 'ya29.a0AfH6SMCscccd_9xA1B2C3';
const APP_SECRET = process.env.WABA_APP_SECRET || 'ya29.a0AfH6SMCscccd_9xA1B2C3';

// In-memory store for received webhook payloads (complete payload)
// and for extracted text messages (dedupe + history).
// In production use a persistent store (database) instead.
const receivedPayloads = [];
const receivedMessages = [];
const seenMessageIds = new Set();

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

function verifySignature(req) {
  const signature = req.get('x-hub-signature-256');
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const expectedHash = signature.split('sha256=')[1];
  const hash = crypto
    .createHmac('sha256', APP_SECRET)
    .update(req.rawBody || '')
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
}

// Webhook verification endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WEBHOOK] VERIFIED');
    res.status(200).send(challenge);
  } else {
    console.warn('[WEBHOOK] Verification failed', { mode, token });
    res.sendStatus(403);
  }
});

// Webhook message processing endpoint
app.post('/webhook', (req, res) => {
  if (!verifySignature(req)) {
    console.warn('[WEBHOOK] Signature verification failed');
    return res.sendStatus(401);
  }

  const body = req.body;
  if (body.object !== 'whatsapp_business_account') {
    return res.sendStatus(404);
  }

  const messages = [];

  (body.entry || []).forEach((entry) => {
    (entry.changes || []).forEach((change) => {
      const value = change.value || {};
      const valueMessages = (value.messages || []).filter((msg) => msg.type === 'text');

      valueMessages.forEach((message) => {
        messages.push({
          phoneNumberId: value.metadata?.phone_number_id,
          from: message.from,
          messageId: message.id,
          timestamp: message.timestamp,
          text: message.text?.body,
          context: message.context,
          referral: message.referral
        });
      });
    });
  });

  if (messages.length === 0) {
    console.log('[WEBHOOK] No text messages found in payload (ignored batch)');
    return res.status(200).send('NO_TEXT_MESSAGES');
  }

  // Store complete webhook payload so /messages can return exact received body
  const payloadId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  receivedPayloads.push({
    payloadId,
    receivedAt: new Date().toISOString(),
    webhookBody: body,
    textMessages: messages
  });

  messages.forEach((msg) => {
    if (seenMessageIds.has(msg.messageId)) {
      console.log('[WEBHOOK] Duplicate text message ignored', msg.messageId);
      return;
    }
    seenMessageIds.add(msg.messageId);
    receivedMessages.push(msg);
    console.log('[TEXT MESSAGE RECEIVED]', msg);
    // TODO: implement custom logic: save to DB, create ticket, auto-reply, business rules
  });

  res.status(200).send('EVENT_RECEIVED');
});

// Get all currently stored received webhook payloads (complete payload)
app.get('/messages', (req, res) => {
  res.status(200).json({ receivedPayloads });
});

// Acknowledge delivered payloads and remove them from local store.
// Accepts body: { payloadIds: ['id1','id2'] } (optional: if omitted, clear all)
app.post('/messages/ack', (req, res) => {
  const ids = Array.isArray(req.body?.payloadIds) ? req.body.payloadIds : null;

  if (!ids) {
    receivedPayloads.length = 0;
    receivedMessages.length = 0;
    seenMessageIds.clear();
    return res.status(200).json({ status: 'cleared_all' });
  }

  const keepPayloads = receivedPayloads.filter((item) => !ids.includes(item.payloadId));
  receivedPayloads.length = 0;
  receivedPayloads.push(...keepPayloads);

  // Also update parsed received messages and dedupe set from remaining payloads.
  const remainingMessageIds = new Set();
  receivedPayloads.forEach((item) => {
    (item.textMessages || []).forEach((m) => remainingMessageIds.add(m.messageId));
  });

  const keepMessages = receivedMessages.filter((msg) => remainingMessageIds.has(msg.messageId));
  receivedMessages.length = 0;
  receivedMessages.push(...keepMessages);

  seenMessageIds.clear();
  keepMessages.forEach((m) => seenMessageIds.add(m.messageId));

  res.status(200).json({ status: 'acknowledged', acknowledged: ids });
});

app.listen(port, () => {
  console.log(`WhatsApp webhook listening on port ${port}`);
  console.log(`VERIFY_TOKEN=${VERIFY_TOKEN}`);
  console.log(`APP_SECRET=${APP_SECRET ? '*****' : '(missing)'}`);
});
