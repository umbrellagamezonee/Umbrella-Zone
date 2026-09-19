import { useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { TableCard } from "../components/TableCard";
import { StartSessionModal } from "../components/StartSessionModal";
import { TableDetailModal } from "../components/TableDetailModal";
import { CheckoutModal } from "../components/Checkout";
import { SplitCheckout } from "../components/SplitCheckout";
import { BillDetailModal } from "../components/BillDetailModal";
import { InstallBanner } from "../components/InstallBanner";
import { AdminPinGate } from "../components/AdminPinGate";
import { useTablesStore } from "../store/useTablesStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useGamesStore } from "../store/useGamesStore";
import { useBillsStore } from "../store/useBillsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, toDateInputValue, formatTime } from "../lib/format";
import { billCollected } from "../lib/billing";
import { billPersonName, billPlace } from "../lib/billLabel";
import { useNow } from "../lib/useNow";
import type { Bill } from "../types";
import { Check, CalendarDays, Trash2, Repeat } from "lucide-react";

export function Home() {
  const tables = useTablesStore((s) => s.tables);
  const startSession = useTablesStore((s) => s.startSession);
  const customers = useCustomersStore((s) => s.customers);
  const findOrCreateCustomer = useCustomersStore((s) => s.findOrCreateCustomer);
  const games = useGamesStore((s) => s.games);
  const bills = useBillsStore((s) => s.bills);
  const softDeleteBill = useBillsStore((s) => s.softDeleteBill);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const now = useNow();

  const [startTableId, setStartTableId] = useState<string | null>(null);
  const [detailTableId, setDetailTableId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(Date.now()));
  const [resumeBill, setResumeBill] = useState<Bill | null>(null);
  const [detailBill, setDetailBill] = useState<Bill | null>(null);
  const [confirmDeleteBillId, setConfirmDeleteBillId] = useState<string | null>(null);

  const startTable = tables.find((t) => t.id === startTableId) || null;
  const detailTable = tables.find((t) => t.id === detailTableId) || null;
  const isToday = selectedDate === toDateInputValue(Date.now());

  // Active tables first (what needs attention right now), available ones
  // below — and within each group, the owner's manual order from
  // Settings → Table Management.
  const sortedTables = [...tables].sort((a, b) => {
    const aAvail = a.status === "available" ? 1 : 0;
    const bAvail = b.status === "available" ? 1 : 0;
    return aAvail - bAvail || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  });

  // Table/game sessions only for the picked day — canteen orders live
  // entirely on their own Canteen page, never mixed in here, so a session's
  // history stays about who played what and when.
  const dateBills = bills
    .filter((b) => b.tableId != null && toDateInputValue(b.createdAt) === selectedDate)
    .sort((a, b) => b.createdAt - a.createdAt);
  const collectedForDate = dateBills
    .filter((b) => b.status !== "cancelled")
    .reduce((sum, b) => sum + billCollected(b), 0);
  const runningCount = tables.filter((t) => t.status !== "available").length;
  const sessionCount = (isToday ? runningCount : 0) + dateBills.length;

  // Quickly starts a fresh session on the same table with the same players
  // as a past one — reuses each name's existing customer profile instead of
  // making everyone type in again.
  function handleRematch(bill: Bill) {
    if (!bill.tableId || !bill.matchParticipants || bill.matchParticipants.length === 0) return;
    const table = tables.find((t) => t.id === bill.tableId);
    if (!table || table.status !== "available") return;
    const [primaryName, ...restNames] = bill.matchParticipants;
    const primary = findOrCreateCustomer({ name: primaryName, phone: "" });
    const extraCustomerIds = restNames.map((name) => findOrCreateCustomer({ name, phone: "" }).id);
    const game = bill.gameId ? games.find((g) => g.id === bill.gameId) : undefined;
    startSession(table.id, primary.id, {
      extraCustomerIds,
      gameId: game?.id ?? null,
      ratePerHour: game?.ratePerHour ?? null,
    });
    setDetailTableId(table.id);
  }

  return (
    <AppShell title="Home">
      <InstallBanner />

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

      <div>
        <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
          TABLES
        </p>
        <div className="space-y-3">
          {sortedTables.map((table) => (
            <TableCard
              key={table.id}
              table={table}
              now={now}
              onOpenDetail={(t) => setDetailTableId(t.id)}
              onStart={(t) => setStartTableId(t.id)}
            />
          ))}
          {tables.length === 0 && (
            <p className="text-center text-sm text-[var(--color-text-faint)] py-6">
              No tables yet — add some in Settings → Table Management.
            </p>
          )}
        </div>
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
              // Name first, table/canteen second — the owner scans this list by
              // "who was that", not by which table.
              const who = billPersonName(bill, customer);
              const where = billPlace(bill);
              const canResume = bill.status === "open";
              const rematchTable = bill.tableId ? tables.find((t) => t.id === bill.tableId) : null;
              const canRematch =
                !!rematchTable &&
                rematchTable.status === "available" &&
                !!bill.matchParticipants &&
                bill.matchParticipants.length > 0;
              return (
                <Card
                  key={bill.id}
                  onClick={() => (canResume ? setResumeBill(bill) : setDetailBill(bill))}
                  className={bill.status === "cancelled" ? "opacity-50" : ""}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{who}</p>
                      <p className="text-xs text-[var(--color-text-dim)]">
                        {where} · {formatTime(bill.createdAt)}
                      </p>
                      {bill.matchParticipants && bill.matchParticipants.length > 1 && (
                        <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
                          {bill.matchParticipants.join(" vs ")}
                          {bill.matchLosers && bill.matchLosers.length > 0 &&
                            ` · ${bill.matchLosers.join(", ")} lost`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatMoney(bill.total, currency)}</p>
                        {bill.status === "paid" && bill.amountPaid > 0 && (
                          <p className="text-xs text-[var(--color-success)] flex items-center gap-1 justify-end">
                            <Check size={11} /> Paid
                          </p>
                        )}
                        {bill.amountDue > 0 && (
                          <p className="text-xs text-[var(--color-warning)]">
                            {formatMoney(bill.amountDue, currency)} on credit
                          </p>
                        )}
                        {bill.status === "open" && (
                          <p className="text-xs text-[var(--color-warning)]">Tap to settle</p>
                        )}
                        {bill.status === "cancelled" && (
                          <p className="text-xs text-[var(--color-text-faint)]">Cancelled</p>
                        )}
                      </div>
                      {bill.tableId && bill.matchParticipants && bill.matchParticipants.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRematch(bill);
                          }}
                          disabled={!canRematch}
                          title={
                            canRematch
                              ? "Start a rematch with the same players"
                              : `${rematchTable?.name ?? "That table"} is busy right now`
                          }
                          className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] disabled:opacity-30 shrink-0"
                        >
                          <Repeat size={14} />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteBillId(bill.id);
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

      {startTable && (
        <StartSessionModal table={startTable} onClose={() => setStartTableId(null)} />
      )}

      {detailTable && (
        <TableDetailModal table={detailTable} onClose={() => setDetailTableId(null)} now={now} />
      )}

      {resumeBill &&
        (resumeBill.shares ? (
          <SplitCheckout bill={resumeBill} onDone={() => setResumeBill(null)} />
        ) : (
          <CheckoutModal bill={resumeBill} onDone={() => setResumeBill(null)} />
        ))}

      {detailBill && <BillDetailModal bill={detailBill} onClose={() => setDetailBill(null)} />}

      {confirmDeleteBillId && (
        <AdminPinGate
          title="Delete session"
          onClose={() => setConfirmDeleteBillId(null)}
          onConfirm={() => softDeleteBill(confirmDeleteBillId)}
        />
      )}
    </AppShell>
  );
}
