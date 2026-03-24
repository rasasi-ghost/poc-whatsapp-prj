# WhatsApp Business Webhook POC

This project implements a simple Node.js webhook endpoint compatible with Meta WhatsApp Business API callback verification and event notifications.

## Endpoints

- `GET /webhook` - verification for `hub.mode=subscribe`, `hub.challenge`, `hub.verify_token`
- `POST /webhook` - event callback payload from WhatsApp Business (type `whatsapp_business_account`)
- `GET /messages` - return locally stored received webhook payloads (full payload, stored by webhook request)
- `POST /messages/ack` - acknowledge and remove received payloads; request body: `{ "payloadIds": ["id1", ...] }` or empty to clear all

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure `.env`:

   ```env
   WABA_VERIFY_TOKEN=vibecoding
   WABA_APP_SECRET=replace_with_your_app_secret
   PORT=3000
   ```

   - `WABA_VERIFY_TOKEN` must match the verify token in the Facebook App Dashboard webhook settings.
   - `WABA_APP_SECRET` is your app secret used for `X-Hub-Signature-256` verification.

3. Start the server:

   ```bash
   npm start
   ```

4. Expose with HTTPS (ngrok or proper SSL) and set Callback URL to:

   `https://<your-public-host>/webhook`

## Verify webhook flow

Facebook will call:

`GET /webhook?hub.mode=subscribe&hub.challenge=<random>&hub.verify_token=<token>`

- If `hub.verify_token` equals `WABA_VERIFY_TOKEN`, the server responds 200 with the challenge string.
- Otherwise responds 403.

## Receive webhook event payloads (text-only)

- `POST /webhook` expects:
  - `Content-Type: application/json`
  - `X-Hub-Signature-256: sha256=<hash>`
  - webhook payload with `object === 'whatsapp_business_account'`

- The server verifies `X-Hub-Signature-256` using `WABA_APP_SECRET` and raw request body.
- If signature is invalid, responds `401`.
- If valid, parses `entry[*].changes[*].value.messages[*]` and processes only `type === 'text'` messages.
- Responds `200` with `EVENT_RECEIVED` (or `NO_TEXT_MESSAGES` for non-text batches).

## Next steps

- Add `entry.changes` handling and message storage.
- Add signature validation (optional, mTLS or X-Hub-Signature from Facebook docs).
