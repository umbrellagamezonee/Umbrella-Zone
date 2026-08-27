import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const LEDGER_PATH = path.join(DATA_DIR, "ledger.json");
const REMINDER_GAP_MS = 24 * 60 * 60 * 1000;

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM,
  REMINDER_CHANNEL = "whatsapp",
  DEFAULT_COUNTRY_CODE = "+91",
  PORT = 4000,
} = process.env;

const isConfigured = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM);

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveLedger(ledger) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}

function normalizePhone(phone) {
  const trimmed = (phone || "").trim();
  if (!trimmed) return null;
  return trimmed.startsWith("+") ? trimmed : `${DEFAULT_COUNTRY_CODE}${trimmed}`;
}

async function sendTwilioMessage(toPhone, body) {
  if (!isConfigured) {
    console.log(`[reminder] Twilio not configured — would send to ${toPhone}: "${body}"`);
    return { sent: false, reason: "not configured" };
  }
  const to = REMINDER_CHANNEL === "whatsapp" ? `whatsapp:${toPhone}` : toPhone;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[reminder] Twilio send failed (${res.status}): ${text}`);
      return { sent: false, reason: `twilio ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("[reminder] Twilio send error:", err);
    return { sent: false, reason: "network error" };
  }
}

function reminderMessage({ name, amountDue, storeName, currencySymbol }) {
  return `Hi ${name}, this is a reminder from ${storeName}: you have an outstanding balance of ${currencySymbol}${amountDue.toFixed(
    2
  )}. Please settle it at your earliest convenience. Thank you!`;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", configured: isConfigured, channel: REMINDER_CHANNEL });
});

// Keeps the ledger's outstanding amount in sync without sending a message.
app.post("/api/sync", (req, res) => {
  const { customerId, name, phone, amountDue } = req.body ?? {};
  if (!customerId) return res.status(400).json({ error: "customerId required" });

  const ledger = loadLedger();
  if (!amountDue || amountDue <= 0) {
    delete ledger[customerId];
  } else {
    ledger[customerId] = { ...ledger[customerId], name, phone, amountDue };
  }
  saveLedger(ledger);
  res.json({ ok: true });
});

// Sends a reminder now and records it in the ledger for the 24h cron follow-up.
app.post("/api/remind", async (req, res) => {
  const { customerId, name, phone, amountDue, storeName, currencySymbol } = req.body ?? {};
  if (!customerId || !amountDue || amountDue <= 0) {
    return res.status(400).json({ error: "customerId and a positive amountDue are required" });
  }

  const toPhone = normalizePhone(phone);
  const ledger = loadLedger();
  const now = Date.now();

  let result = { sent: false, reason: "no phone on file" };
  if (toPhone) {
    result = await sendTwilioMessage(
      toPhone,
      reminderMessage({ name, amountDue, storeName: storeName ?? "the store", currencySymbol: currencySymbol ?? "₹" })
    );
  }

  // Only stamp lastSentAt on a confirmed send — otherwise (Twilio unconfigured,
  // no phone, a failed request) the hourly cron would wait a full day before
  // trying again even though nothing was ever actually delivered.
  const previous = ledger[customerId];
  ledger[customerId] = {
    name,
    phone,
    amountDue,
    lastSentAt: result.sent ? now : previous?.lastSentAt ?? null,
  };
  saveLedger(ledger);

  res.json({ ok: true, ...result });
});

// Follow-up automation: even if the app/browser is closed, anything still owed
// in the ledger gets re-reminded every 24 hours as long as this server is running.
cron.schedule("0 * * * *", async () => {
  const ledger = loadLedger();
  const now = Date.now();
  let changed = false;

  for (const [customerId, entry] of Object.entries(ledger)) {
    if (entry.amountDue > 0 && (!entry.lastSentAt || now - entry.lastSentAt > REMINDER_GAP_MS)) {
      const toPhone = normalizePhone(entry.phone);
      if (!toPhone) continue;
      const result = await sendTwilioMessage(
        toPhone,
        reminderMessage({
          name: entry.name,
          amountDue: entry.amountDue,
          storeName: "the store",
          currencySymbol: "₹",
        })
      );
      // Same rule as /api/remind: only stamp lastSentAt on a confirmed send,
      // so an unconfigured/misconfigured Twilio setup keeps retrying hourly
      // instead of silently going quiet for a day.
      if (result.sent) {
        ledger[customerId] = { ...entry, lastSentAt: now };
        changed = true;
      }
    }
  }

  if (changed) saveLedger(ledger);
});

app.listen(PORT, () => {
  console.log(`[reminder] server listening on http://localhost:${PORT}`);
  console.log(
    isConfigured
      ? `[reminder] Twilio configured (${REMINDER_CHANNEL})`
      : "[reminder] Twilio NOT configured — copy .env.example to .env and fill in credentials to send real messages"
  );
});
