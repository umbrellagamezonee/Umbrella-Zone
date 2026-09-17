import { useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { useCustomersStore } from "../store/useCustomersStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useBillsStore } from "../store/useBillsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, timeAgo } from "../lib/format";
import { customerPendingOrders, orderTotal } from "../lib/billing";
import { sendCreditReminder } from "../lib/reminderApi";
import { customerLabel } from "../lib/customerName";
import { CustomerDetailModal, SettleCreditModal } from "./Customers";
import type { Customer } from "../types";
import { BellRing, Wallet } from "lucide-react";

// Everyone who owes money and the tools to chase it down — kept separate
// from the plain Customers directory so day-to-day lookups aren't buried
// under a wall of due-payment cards. "Owed" here is credit already on the
// books PLUS any served-but-not-yet-billed canteen orders, so this matches
// what that customer's own profile shows as their total (not just the
// narrower credit ledger, which only updates once an order is actually billed).
export function Credits() {
  const customers = useCustomersStore((s) => s.customers);
  const markReminded = useCustomersStore((s) => s.markReminded);
  const adjustCredit = useCustomersStore((s) => s.adjustCredit);
  const orders = useOrdersStore((s) => s.orders);
  const markOrderBilled = useOrdersStore((s) => s.markBilled);
  const bills = useBillsStore((s) => s.bills);
  const createOpenBill = useBillsStore((s) => s.createOpenBill);
  const settlePayment = useBillsStore((s) => s.settlePayment);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const storeName = useSettingsStore((s) => s.storeName);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; ok: boolean } | null>(null);
  const [settleCustomer, setSettleCustomer] = useState<Customer | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  const pendingTotalFor = (customerId: string) =>
    customerPendingOrders(orders, bills, customerId).reduce((sum, o) => sum + orderTotal(o), 0);

  // Settle needs a real credit balance to pay off — a customer whose total
  // here is entirely unbilled pending orders has creditBalance 0, so bill
  // every pending order onto their credit first (same as the 24h auto-credit
  // sweep does), then open Settle for the resulting real balance. Otherwise
  // tapping Settle on a pending-only total silently did nothing.
  function handleSettleClick(c: Customer) {
    const pending = customerPendingOrders(orders, bills, c.id);
    for (const order of pending) {
      const total = orderTotal(order);
      if (total <= 0) continue;
      const bill = createOpenBill({
        tableId: null,
        tableName: c.name,
        orderId: order.id,
        gameId: null,
        gameName: null,
        customerId: c.id,
        tableChargeMinutes: 0,
        tableCharge: 0,
        canteenCharge: total,
        canteenItems: order.items.map((i) => ({
          name: i.name,
          price: i.price,
          qty: i.qty,
          personName: i.personName ?? null,
        })),
        discount: 0,
      });
      markOrderBilled(order.id);
      const settled = settlePayment(bill.id, { amountCash: 0, amountUpi: 0 });
      if (settled) adjustCredit(c.id, settled.amountDue);
    }
    const fresh = useCustomersStore.getState().customers.find((x) => x.id === c.id) ?? c;
    setSettleCustomer(fresh);
  }

  const dueCustomers = customers
    .filter((c) => !c.isWalkIn)
    .map((c) => ({ customer: c, pendingTotal: pendingTotalFor(c.id) }))
    .filter(({ customer: c, pendingTotal }) => c.creditBalance > 0 || pendingTotal > 0)
    .sort((a, b) => (b.customer.creditBalance + b.pendingTotal) - (a.customer.creditBalance + a.pendingTotal));
  const totalDue = dueCustomers.reduce((sum, { customer: c, pendingTotal }) => sum + c.creditBalance + pendingTotal, 0);

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
          {dueCustomers.map(({ customer: c, pendingTotal }) => (
            <Card
              key={c.id}
              onClick={() => setDetailCustomer(c)}
              className="border-[var(--color-warning)]/40"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{customerLabel(c, customers)}</p>
                  <p className="text-xs text-[var(--color-text-dim)]">
                    {c.phone || "No phone"} · {timeAgo(c.lastReminderAt)}
                  </p>
                </div>
                <span className="text-sm font-semibold text-[var(--color-warning)]">
                  {formatMoney(c.creditBalance + pendingTotal, currency)}
                </span>
              </div>
              {pendingTotal > 0 && (
                <p className="text-xs text-[var(--color-text-faint)] mt-1">
                  {formatMoney(c.creditBalance, currency)} on credit · {formatMoney(pendingTotal, currency)} not
                  billed yet
                </p>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSettleClick(c);
                  }}
                  disabled={c.creditBalance === 0 && pendingTotal === 0}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-success)]/15 text-[var(--color-success)] text-sm font-medium py-2 disabled:opacity-40"
                >
                  <Wallet size={14} /> Settle
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemindNow(c.id);
                  }}
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
      {detailCustomer && (
        <CustomerDetailModal customer={detailCustomer} onClose={() => setDetailCustomer(null)} />
      )}
    </AppShell>
  );
}
