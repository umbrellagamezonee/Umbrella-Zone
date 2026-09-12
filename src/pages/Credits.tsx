import { useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { useCustomersStore } from "../store/useCustomersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, timeAgo } from "../lib/format";
import { sendCreditReminder } from "../lib/reminderApi";
import { customerLabel } from "../lib/customerName";
import { SettleCreditModal } from "./Customers";
import { BellRing, Wallet } from "lucide-react";

// Everyone who owes money and the tools to chase it down — kept separate
// from the plain Customers directory so day-to-day lookups aren't buried
// under a wall of due-payment cards.
export function Credits() {
  const customers = useCustomersStore((s) => s.customers);
  const markReminded = useCustomersStore((s) => s.markReminded);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const storeName = useSettingsStore((s) => s.storeName);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; ok: boolean } | null>(null);
  const [settleCustomer, setSettleCustomer] = useState<(typeof customers)[number] | null>(null);

  const dueCustomers = customers
    .filter((c) => !c.isWalkIn && c.creditBalance > 0)
    .sort((a, b) => b.creditBalance - a.creditBalance);
  const totalDue = dueCustomers.reduce((sum, c) => sum + c.creditBalance, 0);

  async function handleRemindNow(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    setSendingId(id);
    setNotice(null);
    const sent = await sendCreditReminder({
      customerId: c.id,
      name: c.name,
      phone: c.phone,
      amountDue: c.creditBalance,
      storeName,
      currencySymbol: currency,
    });
    if (sent) markReminded(id);
    setSendingId(null);
    setNotice({ id, ok: sent });
  }

  return (
    <AppShell title="Credits">
      <div>
        <p className="text-xl font-bold">Credits</p>
        <p className="text-sm text-[var(--color-text-dim)]">
          {dueCustomers.length} customer{dueCustomers.length === 1 ? "" : "s"} owe{" "}
          {formatMoney(totalDue, currency)} total
        </p>
      </div>

      {dueCustomers.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-text-faint)] py-16">
          Nobody's on credit right now.
        </p>
      ) : (
        <div className="space-y-2">
          {dueCustomers.map((c) => (
            <Card key={c.id} className="border-[var(--color-warning)]/40">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{customerLabel(c, customers)}</p>
                  <p className="text-xs text-[var(--color-text-dim)]">
                    {c.phone || "No phone"} · {timeAgo(c.lastReminderAt)}
                  </p>
                </div>
                <span className="text-sm font-semibold text-[var(--color-warning)]">
                  {formatMoney(c.creditBalance, currency)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSettleCustomer(c)}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-success)]/15 text-[var(--color-success)] text-sm font-medium py-2"
                >
                  <Wallet size={14} /> Settle
                </button>
                <button
                  onClick={() => handleRemindNow(c.id)}
                  disabled={sendingId === c.id}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-warning)]/15 text-[var(--color-warning)] text-sm font-medium py-2 disabled:opacity-50"
                >
                  {sendingId === c.id ? (
                    <>Sending…</>
                  ) : (
                    <>
                      <BellRing size={14} /> Remind
                    </>
                  )}
                </button>
              </div>
              {notice?.id === c.id && (
                <p
                  className={
                    "text-xs text-center mt-1.5 " +
                    (notice.ok ? "text-[var(--color-success)]" : "text-[var(--color-text-faint)]")
                  }
                >
                  {notice.ok
                    ? "Message sent."
                    : "Not sent — reminder server isn't running/configured (see server/README.md)."}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--color-text-faint)]">
        Auto-reminded every 24 hours while the app is open. Real WhatsApp/SMS sending needs the
        reminder server running with Twilio credentials — see server/README.md. Unpaid bills/orders
        left untouched for 24 hours land here on their own too.
      </p>

      {settleCustomer && (
        <SettleCreditModal customer={settleCustomer} onClose={() => setSettleCustomer(null)} />
      )}
    </AppShell>
  );
}
