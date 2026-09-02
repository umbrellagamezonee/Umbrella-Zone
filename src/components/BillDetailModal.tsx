import { Modal } from "./ui/Modal";
import { Card } from "./ui/Card";
import { useCustomersStore } from "../store/useCustomersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, formatDuration, formatDateTime } from "../lib/format";
import { billMoney } from "../lib/billing";
import type { Bill } from "../types";
import { Check, X, Trophy, Frown } from "lucide-react";

// Full read-only breakdown of one session/bill: when it started, when it
// ended, what was ordered, who won/lost, and how it was settled — reused
// anywhere a past bill needs to be opened for a look, not just paid.
export function BillDetailModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const customers = useCustomersStore((s) => s.customers);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const customer = customers.find((c) => c.id === bill.customerId);
  const money = billMoney(bill);

  const durationMs = bill.tableChargeMinutes * 60000;
  const startedAt = bill.createdAt - durationMs;
  const hasSessionTime = bill.tableId != null;

  return (
    <Modal title={bill.tableName ?? "Canteen order"} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--color-text-dim)]">
              {customer && !customer.isWalkIn ? customer.name : "Walk-in"}
              {bill.gameName ? ` · ${bill.gameName}` : ""}
            </p>
            <p className="text-2xl font-bold">{formatMoney(bill.total, currency)}</p>
          </div>
          <span
            className={
              "text-[11px] font-medium rounded-full px-2.5 py-1 shrink-0 " +
              (bill.status === "paid"
                ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                : bill.status === "cancelled"
                ? "bg-[var(--color-text-faint)]/15 text-[var(--color-text-faint)]"
                : "bg-[var(--color-warning)]/15 text-[var(--color-warning)]")
            }
          >
            {bill.status === "paid" ? "Paid" : bill.status === "cancelled" ? "Cancelled" : "Open"}
          </span>
        </div>

        {hasSessionTime && (
          <Card>
            <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
              SESSION TIME
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-[var(--color-text-faint)]">Started</p>
                <p className="text-sm font-semibold mt-0.5">{formatDateTime(startedAt)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-faint)]">Ended</p>
                <p className="text-sm font-semibold mt-0.5">{formatDateTime(bill.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-faint)]">Duration</p>
                <p className="text-sm font-semibold mt-0.5">{formatDuration(durationMs)}</p>
              </div>
            </div>
          </Card>
        )}

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

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            WHAT WAS ORDERED
          </p>
          {bill.canteenItems.length === 0 ? (
            <p className="text-sm text-[var(--color-text-faint)]">No food/drinks ordered.</p>
          ) : (
            <div className="space-y-1.5">
              {bill.canteenItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>
                    {item.name} <span className="text-[var(--color-text-faint)]">x{item.qty}</span>
                    {item.personName && (
                      <span className="text-[var(--color-text-faint)]"> · {item.personName}</span>
                    )}
                  </span>
                  <span className="font-medium">{formatMoney(item.price * item.qty, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Card>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            BILL BREAKDOWN
          </p>
          <div className="space-y-1.5 text-sm">
            {hasSessionTime && (
              <div className="flex justify-between">
                <span className="text-[var(--color-text-dim)]">Table charge</span>
                <span>{formatMoney(bill.tableCharge, currency)}</span>
              </div>
            )}
            {bill.canteenCharge > 0 && (
              <div className="flex justify-between">
                <span className="text-[var(--color-text-dim)]">Canteen</span>
                <span>{formatMoney(bill.canteenCharge, currency)}</span>
              </div>
            )}
            {bill.discount > 0 && (
              <div className="flex justify-between text-[var(--color-warning)]">
                <span>Discount</span>
                <span>-{formatMoney(bill.discount, currency)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold pt-1.5 border-t border-[var(--color-border)]">
              <span>Total</span>
              <span>{formatMoney(bill.total, currency)}</span>
            </div>
            {bill.shares ? (
              <div className="pt-1 space-y-1">
                {bill.shares.map((s) => (
                  <div key={s.id} className="flex justify-between">
                    <span className="text-[var(--color-text-dim)]">
                      {s.payerName} · {s.label}
                    </span>
                    <span
                      className={
                        s.status === "paid" ? "text-[var(--color-success)]" : "text-[var(--color-warning)]"
                      }
                    >
                      {s.status === "paid"
                        ? `${formatMoney(s.amount, currency)} · ${s.paymentMethod?.toUpperCase()}`
                        : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              bill.status === "paid" && (
                <>
                  {(money.cash > 0 || money.upi > 0) && (
                    <div className="flex justify-between items-center text-[var(--color-success)]">
                      <span className="flex items-center gap-1">
                        <Check size={12} /> Paid via {bill.paymentMethod?.toUpperCase()}
                      </span>
                      <span>{formatMoney(money.cash + money.upi, currency)}</span>
                    </div>
                  )}
                  {money.credit > 0 && (
                    <div className="flex justify-between text-[var(--color-warning)]">
                      <span>On credit</span>
                      <span>{formatMoney(money.credit, currency)}</span>
                    </div>
                  )}
                </>
              )
            )}
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
