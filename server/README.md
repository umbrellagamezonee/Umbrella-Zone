# CueBill Reminder Server

Sends real WhatsApp/SMS payment-due reminders via Twilio. The main app works
fully without this — it's only needed for actual messages to customers'
phones instead of the in-app "Payment due" list.

## Setup

1. Create a free account at https://www.twilio.com/try-twilio
2. From the [Twilio Console](https://console.twilio.com), copy your **Account SID** and **Auth Token**.
3. For WhatsApp testing, activate the [Twilio Sandbox for WhatsApp](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn) — it gives you a sandbox number and a join code each of your customers would need to send once. For production WhatsApp (no join code needed), you'll need to apply for a Twilio WhatsApp Sender, which takes longer and needs Meta Business verification.
   For plain SMS instead, buy a Twilio phone number and set `REMINDER_CHANNEL=sms`.
4. Copy `.env.example` to `.env` in this folder and fill in the values.
5. Install and run:

```bash
cd server
npm install
npm start
```

The server listens on `http://localhost:4000` by default. Leave it running
(e.g. in its own terminal, or via `pm2`/Task Scheduler) for reminders to keep
firing every 24 hours even when nobody has the app open.

## How it works

- The frontend POSTs to `/api/remind` whenever a customer's credit reminder
  is due (every 24h while the app is open, or when staff taps "Remind now").
- This server records the outstanding amount in `data/ledger.json` and sends
  the WhatsApp/SMS via Twilio.
- An hourly cron job checks that ledger and re-sends to anyone whose last
  reminder was over 24 hours ago — this is what keeps reminders going even
  when the shop's browser tab isn't open, as long as this server process is
  running.
- Without a configured `.env`, the server still runs and logs what it *would*
  have sent, so the rest of the app keeps working.

## Limitations

- This is a local Node process, not a hosted service — it only sends
  reminders while it's running on a machine that's powered on.
- Twilio charges per message after your free trial credit runs out.
- WhatsApp sandbox numbers require each customer to opt in once by sending a
  join code — fine for testing, not for real customers. Apply for your own
  WhatsApp sender for production use.
