const REMINDER_API_BASE = "http://localhost:4000";

export interface ReminderPayload {
  customerId: string;
  name: string;
  phone: string;
  amountDue: number;
  storeName: string;
  currencySymbol: string;
}

// Fire-and-forget: posts to the local reminder backend (server/) if it's running.
// Returns whether a message was actually sent — not just whether the HTTP call
// succeeded, since the backend responds 200 even when Twilio isn't configured.
// Silently no-ops if the backend isn't up — the in-app "Payment due" list still
// works either way, only the real SMS/WhatsApp send depends on this backend.
export async function sendCreditReminder(payload: ReminderPayload): Promise<boolean> {
  try {
    const res = await fetch(`${REMINDER_API_BASE}/api/remind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.sent;
  } catch {
    return false;
  }
}

// Fire-and-forget: keeps the reminder backend's outstanding-balance ledger in
// sync without sending a message. Safe to call on every credit change.
export function syncCreditLedger(payload: {
  customerId: string;
  name: string;
  phone: string;
  amountDue: number;
}) {
  fetch(`${REMINDER_API_BASE}/api/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export async function reminderBackendStatus(): Promise<{ up: boolean; configured: boolean }> {
  try {
    const res = await fetch(`${REMINDER_API_BASE}/api/health`);
    if (!res.ok) return { up: false, configured: false };
    const data = await res.json();
    return { up: true, configured: !!data.configured };
  } catch {
    return { up: false, configured: false };
  }
}
