import { Modal } from "./ui/Modal";
import { Card } from "./ui/Card";
import { useCustomersStore } from "../store/useCustomersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, formatDateTime, formatTime } from "../lib/format";
import { billMoney } from "../lib/billing";
import { billPersonName, billPlace, isCreditSettlement } from "../lib/billLabel";
import type { Bill } from "../types";
import { Check, X, Trophy, Frown } from "lucide-react";

// Full read-only breakdown of one session/bill as a single numbered table:
// row 1 is the table charge with its start/end time, then every food/drink
// with its quantity, then the total — and the payment underneath. Same layout
// whether the bill came from a table, a rematch, or a standalone canteen order.
export function BillDetailModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const customers = useCustomersStore((s) => s.customers);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const customer = customers.find((c) => c.id === bill.customerId);
  const money = billMoney(bill);

  const hasSession = bill.tableId != null;
  const durationMs = bill.tableChargeMinutes * 60000;
  const startedAt = bill.createdAt - durationMs;

  const who = billPersonName(bill, customer);
  const where = billPlace(bill);

  const statusLabel =
    bill.status === "cancelled"
      ? "Cancelled"
      : bill.status === "open"
        ? "Open"
        : bill.amountDue > 0
          ? "On credit"
          : "Paid";

  // Total columns in the table body (used for colspans on the summary rows).
  const cols = hasSession ? 5 : 4;
  const money0 = (n: number) => formatMoney(n, currency);

  return (
    <Modal title={who} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--color-text-dim)]">
              {where} · {formatDateTime(bill.createdAt)}
            </p>
            <p className="text-2xl font-bold">{money0(bill.total)}</p>
          </div>
          <span
            className={
              "text-[11px] font-medium rounded-full px-2.5 py-1 shrink-0 " +
              (bill.status === "cancelled"
                ? "bg-[var(--color-text-faint)]/15 text-[var(--color-text-faint)]"
                : bill.status === "paid" && bill.amountDue === 0
                  ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                  : "bg-[var(--color-warning)]/15 text-[var(--color-warning)]")
            }
          >
            {statusLabel}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)] text-left">
                <th className="font-semibold py-1.5 pr-1 w-5">#</th>
                <th className="font-semibold py-1.5 pr-2">Item</th>
                {hasSession ? (
                  <>
                    <th className="font-semibold py-1.5 px-2 whitespace-nowrap">Start</th>
                    <th className="font-semibold py-1.5 px-2 whitespace-nowrap">End time</th>
                  </>
                ) : (
                  <th className="font-semibold py-1.5 px-2 whitespace-nowrap">Qty</th>
                )}
                <th className="font-semibold py-1.5 pl-2 text-right whitespace-nowrap">Amount</th>
              </tr>
            </thead>
            <tbody>
              {hasSession && (
                <tr className="border-t border-[var(--color-border)] align-top">
                  <td className="py-2 pr-1 text-[var(--color-text-faint)]">1</td>
                  <td className="py-2 pr-2">
                    {bill.tableName ?? "Table"}
                    {bill.gameName && (
                      <span className="block text-xs text-[var(--color-text-faint)]">
                        {bill.gameName}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap">{formatTime(startedAt)}</td>
                  <td className="py-2 px-2 whitespace-nowrap">{formatTime(bill.createdAt)}</td>
                  <td className="py-2 pl-2 text-right font-medium whitespace-nowrap">
                    {money0(bill.tableCharge)}
                  </td>
                </tr>
              )}

              {bill.canteenItems.map((item, idx) => (
                <tr key={idx} className="border-t border-[var(--color-border)] align-top">
                  <td className="py-2 pr-1 text-[var(--color-text-faint)]">
                    {(hasSession ? 2 : 1) + idx}
                  </td>
                  <td className="py-2 pr-2">
                    {item.name}
                    {item.personName && (
                      <span className="block text-xs text-[var(--color-text-faint)]">
                        {item.personName}
                      </span>
                    )}
                  </td>
                  <td
                    className="py-2 px-2 whitespace-nowrap text-[var(--color-text-dim)]"
                    colSpan={hasSession ? 2 : 1}
                  >
                    ×{item.qty}
                  </td>
                  <td className="py-2 pl-2 text-right font-medium whitespace-nowrap">
                    {money0(item.price * item.qty)}
                  </td>
                </tr>
              ))}

              {bill.canteenItems.length === 0 && !hasSession && (
                <tr className="border-t border-[var(--color-border)]">
                  <td colSpan={cols} className="py-3 text-center text-[var(--color-text-faint)]">
                    {isCreditSettlement(bill)
                      ? "Payment toward an outstanding balance"
                      : "Nothing itemised on this bill."}
                  </td>
                </tr>
              )}

              {bill.discount > 0 && (
                <tr className="border-t border-[var(--color-border)] text-[var(--color-warning)]">
                  <td colSpan={cols - 1} className="py-2 pr-2">
                    Discount
                  </td>
                  <td className="py-2 pl-2 text-right whitespace-nowrap">
                    -{money0(bill.discount)}
                  </td>
                </tr>
              )}

              <tr className="border-t-2 border-[var(--color-border)] font-semibold">
                <td colSpan={cols - 1} className="py-2 pr-2">
                  Total
                </td>
                <td className="py-2 pl-2 text-right whitespace-nowrap">{money0(bill.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {bill.matchParticipants && bill.matchParticipants.length > 1 && (
          <Card>
            <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
              WHO PLAYED
            </p>
            <div className="space-y-1.5">
              {bill.matchParticipants.map((name) => {
                const lost = bill.matchLosers?.includes(name) ?? false;
                const hasLosers = (bill.matchLosers?.length ?? 0) > 0;
                return (
                  <div key={name} className="flex items-center gap-2">
                    {lost ? (
                      <Frown size={15} className="text-[var(--color-danger)] shrink-0" />
                    ) : (
                      <Trophy size={15} className="text-[var(--color-success)] shrink-0" />
                    )}
                    <span className="text-sm">{name}</span>
                    <span
                      className={
                        "text-xs ml-auto " +
                        (lost ? "text-[var(--color-danger)]" : "text-[var(--color-text-faint)]")
                      }
                    >
                      {lost ? "Lost · billed" : hasLosers ? "Won" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <Card>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            PAYMENT
          </p>
          <div className="space-y-1.5 text-sm">
            {bill.shares ? (
              bill.shares.map((s) => (
                <div key={s.id} className="flex justify-between">
                  <span className="text-[var(--color-text-dim)]">
                    {s.payerName} · {s.label}
                  </span>
                  <span
                    className={
                      s.status === "paid" && s.paymentMethod !== "credit"
                        ? "text-[var(--color-success)]"
                        : "text-[var(--color-warning)]"
                    }
                  >
                    {s.status === "paid"
                      ? `${money0(s.amount)} · ${s.paymentMethod?.toUpperCase()}`
                      : "Pending"}
                  </span>
                </div>
              ))
            ) : bill.status === "paid" ? (
              <>
                {(money.cash > 0 || money.upi > 0) && (
                  <div className="flex justify-between items-center text-[var(--color-success)]">
                    <span className="flex items-center gap-1">
                      <Check size={12} /> Paid via {bill.paymentMethod?.toUpperCase()}
                    </span>
                    <span>{money0(money.cash + money.upi)}</span>
                  </div>
                )}
                {money.credit > 0 && (
                  <div className="flex justify-between text-[var(--color-warning)]">
                    <span>On credit</span>
                    <span>{money0(money.credit)}</span>
                  </div>
                )}
              </>
            ) : bill.status === "open" ? (
              <div className="flex justify-between text-[var(--color-warning)]">
                <span>Not settled yet</span>
                <span>{money0(bill.total)}</span>
              </div>
            ) : null}
            {bill.paidAt && (
              <p className="text-xs text-[var(--color-text-faint)] pt-0.5">
                Settled {formatDateTime(bill.paidAt)}
              </p>
            )}
            {bill.status === "cancelled" && (
              <p className="flex items-center gap-1 text-[var(--color-text-faint)]">
                <X size={12} /> This bill was cancelled — nothing collected.
              </p>
            )}
          </div>
        </Card>
      </div>
    </Modal>
  );
}
