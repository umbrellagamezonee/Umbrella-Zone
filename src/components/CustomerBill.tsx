import { createPortal } from "react-dom";
import { useBillsStore } from "../store/useBillsStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { billParts, businessTotals } from "../lib/billing";
import { billPersonName } from "../lib/billLabel";
import { formatDateTime, formatMoney, formatSessionLength, formatTime } from "../lib/format";
import type { Bill } from "../types";
import { Printer, X } from "lucide-react";

// The bill a customer asks to see: gaming and canteen each on their own — for the
// gaming part when it started, when it ended and how long it ran — and the total.
// If the bill is already paid it also says how each of the two was paid. This is the
// card only; CustomerBillModal wraps it as a full screen with PDF / Print, and the
// checkout shows it right above the Cash / Account / Credit choice.
export function BillSlipBody({ bill: initial }: { bill: Bill }) {
  const live = useBillsStore((s) => s.bills.find((b) => b.id === initial.id));
  const bill = live ?? initial;
  const customers = useCustomersStore((s) => s.customers);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const storeName = useSettingsStore((s) => s.storeName);
  const m = (n: number) => formatMoney(n, currency);

  const who = billPersonName(bill, customers.find((c) => c.id === bill.customerId));
  const totals = businessTotals(bill);
  const hasGaming = bill.tableCharge > 0;
  const hasCanteen = bill.canteenCharge > 0 || bill.canteenItems.length > 0;
  const minutes = Math.round(bill.tableChargeMinutes);
  const startedAt = bill.createdAt - bill.tableChargeMinutes * 60000;
  const paidParts = bill.status === "paid" && !bill.shares ? billParts(bill) : null;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
      <div className="text-center">
        <p className="text-lg font-bold">{storeName}</p>
        <p className="text-xs text-[var(--color-text-dim)]">
          {formatDateTime(bill.createdAt)} · {who}
          {bill.tableName && bill.tableId ? ` · ${bill.tableName}` : ""}
        </p>
      </div>

      {hasGaming && (
        <section>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1">GAMING</p>
          <div className="flex justify-between text-sm py-1">
            <span>
              {bill.tableName ?? "Table"}
              {bill.gameName ? ` · ${bill.gameName}` : ""}
            </span>
            <span>{m(bill.tableCharge)}</span>
          </div>
          <p className="text-xs text-[var(--color-text-dim)] pb-1">
            {minutes > 0
              ? `Shuru ${formatTime(startedAt)} · Khatam ${formatTime(bill.createdAt)} · Time ${formatSessionLength(minutes)}`
              : "Time record nahi hua"}
          </p>
          <div className="flex justify-between text-sm font-semibold border-t border-[var(--color-border)] pt-1">
            <span>Gaming total</span>
            <span>{m(bill.tableCharge)}</span>
          </div>
        </section>
      )}

      {hasCanteen && (
        <section>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1">CANTEEN</p>
          {bill.canteenItems.map((item, i) => (
            <div key={i} className="flex justify-between text-sm py-0.5">
              <span>
                {item.name} × {item.qty}
              </span>
              <span>{m(item.price * item.qty)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-semibold border-t border-[var(--color-border)] pt-1 mt-1">
            <span>Canteen total</span>
            <span>{m(bill.canteenCharge)}</span>
          </div>
        </section>
      )}

      {bill.discount > 0 && (
        <div className="flex justify-between text-sm text-[var(--color-warning)]">
          <span>Discount</span>
          <span>−{m(bill.discount)}</span>
        </div>
      )}

      {hasGaming && hasCanteen && (
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-[var(--color-surface-2)] py-2">
            <p className="text-[11px] text-[var(--color-text-dim)]">Gaming</p>
            <p className="text-base font-bold">{m(totals.gaming)}</p>
          </div>
          <div className="rounded-xl bg-[var(--color-surface-2)] py-2">
            <p className="text-[11px] text-[var(--color-text-dim)]">Canteen</p>
            <p className="text-base font-bold">{m(totals.canteen)}</p>
          </div>
        </div>
      )}

      <div className="flex justify-between items-baseline border-t-2 border-[var(--color-border)] pt-2">
        <span className="text-base font-semibold">Kul bill</span>
        <span className="text-2xl font-bold">{m(bill.total)}</span>
      </div>

      {paidParts && (
        <section className="space-y-1 text-sm">
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)]">PAYMENT</p>
          {([
            ["Gaming", paidParts.gaming],
            ["Canteen", paidParts.canteen],
          ] as const)
            .filter(([, p]) => p.total > 0.005)
            .map(([label, p]) => (
              <div key={label} className="flex justify-between gap-2">
                <span className="text-[var(--color-text-dim)]">{label}</span>
                <span className="text-right">
                  {[
                    p.cash > 0.005 ? `Cash ${m(p.cash)}` : "",
                    p.upi > 0.005 ? `Account ${m(p.upi)}` : "",
                    p.due > 0.005 ? `Credit ${m(p.due)}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </span>
              </div>
            ))}
        </section>
      )}
      {bill.shares && (
        <section className="space-y-1 text-sm">
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)]">PAYMENT</p>
          {bill.shares.map((s) => (
            <div key={s.id} className="flex justify-between gap-2">
              <span className="text-[var(--color-text-dim)]">
                {s.payerName} · {s.label}
              </span>
              <span>
                {m(s.amount)} ·{" "}
                {s.status === "paid" ? (s.paymentMethod === "upi" ? "Account" : s.paymentMethod === "credit" ? "Credit" : "Cash") : "baaki"}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// Full screen version: for showing the customer, and for saving / printing as a PDF. It only
// reads the bill - nothing on it can be changed from here.
export function CustomerBillModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  return createPortal(
    <div className="print-slip fixed inset-0 z-[70] overflow-y-auto bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="mx-auto max-w-md p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 print:hidden">
          <h2 className="text-base font-semibold">Customer Bill</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white"
            >
              <Printer size={14} /> PDF / Print
            </button>
            <button
              onClick={onClose}
              className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-dim)]"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <BillSlipBody bill={bill} />
      </div>
    </div>,
    document.body
  );
}
