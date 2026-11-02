# Message delivery: email, SMS and WhatsApp

Every notice, fee reminder, attendance alert and safety message appears **in the app** (the bell and the family portal). This guide is for also sending copies by **email, SMS or WhatsApp**.

## How it works
1. A family member switches on the channels they want (**My account → How we contact you**). SMS and WhatsApp are **off by default** and need their agreement (this is their consent).
2. When the school sends something, the app queues one message per person per channel. The same message is never queued twice for the same person on the same day.
3. A worker sends queued messages every two minutes. Failures are retried after 2, 4, 8 and 16 minutes, then marked **failed**. Administrators see this under **Admin → Message delivery** and can retry.
4. Safety messages (a child leaving early, pickup approvals) cannot be muted. Other topics can.
5. Contact details are masked in the delivery log.

## What you need to provide
The app does **not** hold SMS/WhatsApp/email accounts itself. It sends each message to a **relay address you control**, which forwards it to your provider. That keeps provider keys out of the school system and lets you pick any provider (for Indian SMS and WhatsApp, a registered provider such as MSG91, Gupshup, Twilio or an email service such as Amazon SES). WhatsApp business messages and Indian SMS also need **registered sender names and approved message templates**; your provider will guide you.

Set these on the server (never commit them):

| Setting | Meaning |
|---|---|
| `NOTIFY_PROVIDER` | `webhook` to turn delivery on. `off` (default) keeps everything in-app. |
| `NOTIFY_WEBHOOK_URL` | The https address of your relay. |
| `NOTIFY_WEBHOOK_SECRET` | At least 16 random characters. The app signs each request with it. |

## What the relay receives
`POST` with header `x-signature` = hex HMAC-SHA256 of the raw body using the secret, and JSON body:
```json
{ "id": 123, "channel": "sms", "to": "9876543210", "subject": null, "body": "Left school: Anya left school at 2:10 pm with Uncle Raj.", "category": "safety" }
```
Reply with any `2xx` status (optionally `{ "id": "provider-message-id" }`). Any other answer is treated as a failure and retried. **Check the signature before sending anything.**

## Status
The queue, preferences, retries, de-duplication, masking and signed delivery are built and covered by automated tests that use a local test relay. **It has not been tested against a live SMS, WhatsApp or email provider**, because that needs your accounts. Test with a few staff phones before using it with families.

On a serverless host (such as the Vercel trial) there is no always-on worker: press **Send waiting messages now** in the delivery log, or use the Docker setup, which runs the worker.
