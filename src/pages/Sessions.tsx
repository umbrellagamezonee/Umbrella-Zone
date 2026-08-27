import { useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { TableDetailModal } from "../components/TableDetailModal";
import { Checkout, CheckoutModal } from "../components/Checkout";
import { SplitCheckout } from "../components/SplitCheckout";
import { Modal } from "../components/ui/Modal";
import { useTablesStore } from "../store/useTablesStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useGamesStore } from "../store/useGamesStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useBillsStore } from "../store/useBillsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import {
  formatDuration,
  formatMoney,
  elapsedMinutesExact,
  costForElapsed,
  toDateInputValue,
  formatTime,
} from "../lib/format";
import { billCollected } from "../lib/billing";
import { tableElapsedMs, tableRemainingMs, activeRate } from "../lib/tableTiming";
import { useNow } from "../lib/useNow";
import type { BillingTable, Bill } from "../types";
import { Wallet, Gamepad2, Check, CalendarDays, Trash2 } from "lucide-react";

export function Sessions() {
  const tables = useTablesStore((s) => s.tables);
  const stopSession = useTablesStore((s) => s.stopSession);
  const updateTable = useTablesStore((s) => s.updateTable);
  const customers = useCustomersStore((s) => s.customers);
  const games = useGamesStore((s) => s.games);
  const orders = useOrdersStore((s) => s.orders);
  const markBilled = useOrdersStore((s) => s.markBilled);
  const unmarkBilled = useOrdersStore((s) => s.unmarkBilled);
  const bills = useBillsStore((s) => s.bills);
  const createOpenBill = useBillsStore((s) => s.createOpenBill);
  const deleteBill = useBillsStore((s) => s.deleteBill);
  const softDeleteBill = useBillsStore((s) => s.softDeleteBill);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const now = useNow();

  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(Date.now()));
  const [detailTableId, setDetailTableId] = useState<string | null>(null);
  const [quickBill, setQuickBill] = useState<Bill | null>(null);
  const [quickUndo, setQuickUndo] = useState<{
    tableId: string;
    tableSnapshot: Partial<BillingTable>;
    orderId: string | null;
    billId: string;
  } | null>(null);
  const [resumeBill, setResumeBill] = useState<Bill | null>(null);

  const isToday = selectedDate === toDateInputValue(Date.now());

  const liveActive = tables
    .filter((t) => t.status !== "available")
    .sort((a, b) => (b.sessionStartedAt ?? 0) - (a.sessionStartedAt ?? 0));

  // Only show table sessions here (not standalone canteen bills), for the picked day.
  const dateBills = bills
    .filter((b) => b.tableId && toDateInputValue(b.createdAt) === selectedDate)
    .sort((a, b) => b.createdAt - a.createdAt);

  const collectedForDate = dateBills
    .filter((b) => b.status !== "cancelled")
    .reduce((sum, b) => sum + billCollected(b), 0);
  const sessionCount = (isToday ? liveActive.length : 0) + dateBills.length;

  const detailTable = tables.find((t) => t.id === detailTableId) || null;

  function quickStopAndBill(table: BillingTable) {
    const order = orders.find((o) => o.tableId === table.id && o.status !== "billed");
    const canteenTotal = order?.items.reduce((sum, i) => sum + i.price * i.qty, 0) ?? 0;
    const rate = activeRate(table);
    const elapsed = tableElapsedMs(table, now);
    const minutesBilled = elapsedMinutesExact(elapsed);
    const tableCharge = costForElapsed(elapsed, rate);
    const game = games.find((g) => g.id === table.activeGameId);

    const tableSnapshot: Partial<BillingTable> = {
      status: table.status,
      customerId: table.customerId,
      extraCustomerIds: table.extraCustomerIds,
      activeGameId: table.activeGameId,
      sessionRatePerHour: table.sessionRatePerHour,
      sessionStartedAt: table.sessionStartedAt,
      accumulatedMs: table.accumulatedMs,
      plannedDurationMs: table.plannedDurationMs,
    };

    stopSession(table.id);
    const bill = createOpenBill({
      tableId: table.id,
      tableName: table.name,
      gameId: game?.id ?? null,
      gameName: game?.name ?? null,
      customerId: table.customerId,
      tableChargeMinutes: minutesBilled,
      tableCharge,
      canteenCharge: canteenTotal,
      canteenItems: order?.items.map((i) => ({ name: i.name, price: i.price, qty: i.qty })) ?? [],
      discount: 0,
    });
    if (order) markBilled(order.id);
    setQuickUndo({ tableId: table.id, tableSnapshot, orderId: order?.id ?? null, billId: bill.id });
    setQuickBill(bill);
  }

  // Cancelling before payment (X, or Back inside checkout) undoes the stop
  // entirely — otherwise clicking Pay is a one-way trip with no way back to
  // the still-running session, even by mistake.
  function cancelQuickBill() {
    if (quickUndo) {
      updateTable(quickUndo.tableId, quickUndo.tableSnapshot);
      if (quickUndo.orderId) unmarkBilled(quickUndo.orderId);
      deleteBill(quickUndo.billId);
      setQuickUndo(null);
    }
    setQuickBill(null);
  }

  return (
    <AppShell title="Sessions">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-[var(--color-text-dim)]">SESSIONS</p>
          <p className="text-xl font-bold mt-1">{sessionCount}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--color-text-dim)]">COLLECTED</p>
          <p className="text-xl font-bold text-[var(--color-success)] mt-1">
            {formatMoney(collectedForDate, currency)}
          </p>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <CalendarDays size={16} className="text-[var(--color-text-faint)] shrink-0" />
        <input
          type="date"
          value={selectedDate}
          max={toDateInputValue(Date.now())}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="flex-1 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm outline-none"
        />
        {!isToday && (
          <button
            onClick={() => setSelectedDate(toDateInputValue(Date.now()))}
            className="text-xs font-medium text-[var(--color-primary)] px-2"
          >
            Today
          </button>
        )}
      </div>

      {isToday && (
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            ACTIVE NOW
          </p>
          {liveActive.length === 0 ? (
            <p className="text-center text-sm text-[var(--color-text-faint)] py-6">
              No one's playing right now — start a session from Home.
            </p>
          ) : (
            <div className="space-y-3">
              {liveActive.map((table) => {
                const customer = customers.find((c) => c.id === table.customerId);
                const extraNames = table.extraCustomerIds
                  .map((id) => customers.find((c) => c.id === id)?.name)
                  .filter((n): n is string => !!n);
                const peopleLabel = [customer ? customer.name : "Walk-in", ...extraNames].join(", ");
                const game = games.find((g) => g.id === table.activeGameId);
                const elapsed = tableElapsedMs(table, now);
                const rate = activeRate(table);
                const cost = costForElapsed(elapsed, rate);
                const remaining = tableRemainingMs(table, now);
                const overtime = remaining != null && remaining < 0;

                return (
                  <Card
                    key={table.id}
                    onClick={() => setDetailTableId(table.id)}
                    className={
                      table.status === "paused"
                        ? "border-[var(--color-warning)]/50"
                        : overtime
                        ? "border-[var(--color-danger)]/50"
                        : "border-[var(--color-success)]/50"
                    }
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{table.name}</p>
                        <p className="text-xs text-[var(--color-text-dim)]">{peopleLabel}</p>
                        {game && (
                          <p className="text-xs text-[var(--color-accent)] flex items-center gap-1 mt-0.5">
                            <Gamepad2 size={11} /> {game.name}
                          </p>
                        )}
                      </div>
                      <span
                        className={
                          "text-[11px] font-medium rounded-full px-2.5 py-1 " +
                          (table.status === "paused"
                            ? "bg-[var(--color-warning)]/15 text-[var(--color-warning)]"
                            : overtime
                            ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
                            : "bg-[var(--color-success)]/15 text-[var(--color-success)]")
                        }
                      >
                        {table.status === "paused" ? "Paused" : overtime ? "Overtime" : "Running"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <div>
                        <p className="text-lg font-bold font-mono">{formatDuration(elapsed)}</p>
                        <p className="text-xs text-[var(--color-text-dim)]">{formatMoney(cost, currency)}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          quickStopAndBill(table);
                        }}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium px-4 py-2.5"
                      >
                        <Wallet size={14} /> Pay
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div>
        <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
          {isToday ? "COMPLETED TODAY" : "HISTORY"}
        </p>
        {dateBills.length === 0 ? (
          <p className="text-center text-sm text-[var(--color-text-faint)] py-6">
            No sessions on this day.
          </p>
        ) : (
          <div className="space-y-2">
            {dateBills.map((bill) => {
              const customer = customers.find((c) => c.id === bill.customerId);
              const canResume = bill.status === "open";
              return (
                <Card
                  key={bill.id}
                  onClick={() => canResume && setResumeBill(bill)}
                  className={bill.status === "cancelled" ? "opacity-50" : ""}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{bill.tableName}</p>
                      <p className="text-xs text-[var(--color-text-dim)]">
                        {customer && !customer.isWalkIn ? customer.name : "Walk-in"} ·{" "}
                        {formatTime(bill.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatMoney(bill.total, currency)}</p>
                        {bill.status === "paid" && (
                          <p className="text-xs text-[var(--color-success)] flex items-center gap-1 justify-end">
                            <Check size={11} /> Paid
                          </p>
                        )}
                        {bill.status === "open" && (
                          <p className="text-xs text-[var(--color-warning)]">Tap to settle</p>
                        )}
                        {bill.status === "cancelled" && (
                          <p className="text-xs text-[var(--color-text-faint)]">Cancelled</p>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          softDeleteBill(bill.id);
                        }}
                        title="Delete this session (recoverable from Settings → Deleted Bills)"
                        className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)] shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {detailTable && (
        <TableDetailModal table={detailTable} onClose={() => setDetailTableId(null)} now={now} />
      )}

      {quickBill &&
        (quickBill.shares ? (
          <SplitCheckout bill={quickBill} onDone={() => setQuickBill(null)} />
        ) : (
          <Modal title={quickBill.tableName ?? "Checkout"} onClose={cancelQuickBill}>
            <Checkout
              bill={quickBill}
              onDone={() => setQuickBill(null)}
              onCancel={cancelQuickBill}
              onSettled={() => setQuickUndo(null)}
            />
          </Modal>
        ))}

      {resumeBill &&
        (resumeBill.shares ? (
          <SplitCheckout bill={resumeBill} onDone={() => setResumeBill(null)} />
        ) : (
          <CheckoutModal bill={resumeBill} onDone={() => setResumeBill(null)} />
        ))}
    </AppShell>
  );
}
