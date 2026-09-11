import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { useBillsStore } from "../store/useBillsStore";
import { useExpensesStore } from "../store/useExpensesStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useMenuStore } from "../store/useMenuStore";
import { useGamesStore } from "../store/useGamesStore";
import { useTablesStore } from "../store/useTablesStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, formatTime, isToday, isThisMonth, toDateInputValue } from "../lib/format";
import { billMoney, billCollected, billRemaining } from "../lib/billing";
import { billPersonName, billPlace } from "../lib/billLabel";
import { useCustomersStore } from "../store/useCustomersStore";
import { orderedTables } from "../store/useTablesStore";
import { BillDetailModal } from "../components/BillDetailModal";
import type { Bill } from "../types";
import {
  Wallet,
  CreditCard,
  TrendingUp,
  Coffee,
  Search,
  SlidersHorizontal,
  Bed,
  CalendarDays,
  LayoutGrid,
  FileSpreadsheet,
} from "lucide-react";

export function Reports() {
  const bills = useBillsStore((s) => s.bills);
  const tables = useTablesStore((s) => s.tables);
  const customers = useCustomersStore((s) => s.customers);
  const todaysBills = useMemo(() => bills.filter((b) => isToday(b.createdAt)), [bills]);
  const monthBills = useMemo(() => bills.filter((b) => isThisMonth(b.createdAt)), [bills]);
  const expenses = useExpensesStore((s) => s.expenses);
  const addExpense = useExpensesStore((s) => s.addExpense);
  const categories = useExpensesStore((s) => s.categories);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const [search, setSearch] = useState("");
  const [showExpense, setShowExpense] = useState(false);
  const [showCafeReport, setShowCafeReport] = useState(false);
  const [showGalla, setShowGalla] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showTableReport, setShowTableReport] = useState(false);
  const [checkDate, setCheckDate] = useState(() => toDateInputValue(Date.now()));
  const [detailBill, setDetailBill] = useState<Bill | null>(null);

  const nonCancelledBills = todaysBills.filter((b) => b.status !== "cancelled");
  const cancelledBills = todaysBills.filter((b) => b.status === "cancelled");

  const totals = useMemo(() => {
    let collected = 0;
    let billedOnCredit = 0;
    for (const b of nonCancelledBills) {
      const m = billMoney(b);
      collected += m.cash + m.upi;
      billedOnCredit += m.credit;
    }
    return { totalCollected: collected, collected, billedOnCredit };
  }, [nonCancelledBills]);

  const collectedToday = useMemo(
    () => nonCancelledBills.reduce((sum, b) => sum + billCollected(b), 0),
    [nonCancelledBills]
  );

  const collectedThisMonth = useMemo(
    () =>
      monthBills
        .filter((b) => b.status !== "cancelled")
        .reduce((sum, b) => sum + billCollected(b), 0),
    [monthBills]
  );

  const collectedOnCheckDate = useMemo(
    () =>
      bills
        .filter((b) => toDateInputValue(b.createdAt) === checkDate && b.status !== "cancelled")
        .reduce((sum, b) => sum + billCollected(b), 0),
    [bills, checkDate]
  );

  const cashInDrawer = useMemo(() => {
    const todaysExpenses = expenses
      .filter((e) => isToday(e.createdAt))
      .reduce((sum, e) => sum + e.amount, 0);
    return collectedToday - todaysExpenses;
  }, [collectedToday, expenses]);

  const running = tables.filter((t) => t.status === "running").length;
  const paused = tables.filter((t) => t.status === "paused").length;
  const available = tables.filter((t) => t.status === "available").length;
  const openBills = bills.filter((b) => b.status === "open");
  const openBillsTotal = openBills.reduce((sum, b) => sum + billRemaining(b), 0);
  const activeCount = running + paused;

  const filteredBills = todaysBills.filter((b) => {
    const q = search.toLowerCase();
    return (
      (b.tableName ?? "").toLowerCase().includes(q) ||
      billPersonName(b, customers.find((c) => c.id === b.customerId)).toLowerCase().includes(q) ||
      (b.matchParticipants ?? []).some((n) => n.toLowerCase().includes(q))
    );
  });

  return (
    <AppShell title="Reports">
      <div>
        <p className="text-3xl font-bold text-[var(--color-primary)]">
          {formatMoney(cashInDrawer, currency)}
        </p>
        <p className="text-xs text-[var(--color-text-dim)] mt-1">
          Cash in drawer · today's collection minus expenses
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-[var(--color-text-dim)]">COLLECTED TODAY</p>
          <p className="text-xl font-bold text-[var(--color-success)] mt-1">
            {formatMoney(collectedToday, currency)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--color-text-dim)]">THIS MONTH</p>
          <p className="text-xl font-bold text-[var(--color-success)] mt-1">
            {formatMoney(collectedThisMonth, currency)}
          </p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-2 mb-2">
          <CalendarDays size={14} className="text-[var(--color-text-faint)] shrink-0" />
          <span className="text-xs text-[var(--color-text-dim)]">Check any date</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={checkDate}
            max={toDateInputValue(Date.now())}
            onChange={(e) => setCheckDate(e.target.value)}
            className="flex-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-sm outline-none"
          />
          <p className="text-lg font-bold text-[var(--color-success)] whitespace-nowrap">
            {formatMoney(collectedOnCheckDate, currency)}
          </p>
        </div>
      </Card>

      <div>
        <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
          FLOOR NOW
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">RUNNING</p>
            <p className="text-2xl font-bold text-[var(--color-success)] mt-1">{running}</p>
            <p className="text-xs text-[var(--color-text-faint)]">Active sessions</p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">PAUSED</p>
            <p className="text-2xl font-bold text-[var(--color-warning)] mt-1">{paused}</p>
            <p className="text-xs text-[var(--color-text-faint)]">On hold</p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">AVAILABLE</p>
            <p className="text-2xl font-bold mt-1">{available}</p>
            <p className="text-xs text-[var(--color-text-faint)]">{available} billing tables</p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">OPEN BILLS</p>
            <p className="text-2xl font-bold mt-1">{openBills.length}</p>
            <p className="text-xs text-[var(--color-text-faint)]">
              {formatMoney(openBillsTotal, currency)}
            </p>
          </Card>
        </div>

        <Card className="mt-3 flex items-center justify-center gap-2 text-[var(--color-text-dim)]">
          <Bed size={18} />
          <span className="text-sm">
            {activeCount === 0
              ? "No active sessions right now"
              : `${activeCount} active session${activeCount > 1 ? "s" : ""} right now`}
          </span>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card onClick={() => setShowGalla(true)}>
          <div className="flex items-center gap-2 text-[var(--color-primary)]">
            <Wallet size={16} />
            <p className="text-sm font-semibold">Galla summary</p>
          </div>
        </Card>
        <Link to="/customers">
          <Card>
            <div className="flex items-center gap-2 text-[var(--color-primary)]">
              <CreditCard size={16} />
              <p className="text-sm font-semibold">Khata / Credit</p>
            </div>
          </Card>
        </Link>
        <Card onClick={() => setShowInsights(true)}>
          <div className="flex items-center gap-2 text-[var(--color-primary)]">
            <TrendingUp size={16} />
            <p className="text-sm font-semibold">Insights</p>
          </div>
        </Card>
        <Card onClick={() => setShowCafeReport(true)}>
          <div className="flex items-center gap-2 text-[var(--color-primary)]">
            <Coffee size={16} />
            <p className="text-sm font-semibold">Cafe Report</p>
          </div>
        </Card>
      </div>

      <Card onClick={() => setShowTableReport(true)}>
        <div className="flex items-center gap-2 text-[var(--color-primary)]">
          <LayoutGrid size={16} />
          <p className="text-sm font-semibold">Table Report</p>
        </div>
        <p className="text-xs text-[var(--color-text-faint)] mt-1">
          Pick a table, see every session that day — start, end, who played, paid or credit
        </p>
      </Card>

      <Card>
        <p className="text-xs text-[var(--color-text-dim)]">FILTERS APPLIED</p>
        <p className="text-sm mt-0.5">Today · All statuses · All payments</p>
      </Card>

      <div className="flex gap-3">
        <Card className="flex-1 flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-dim)]">BILLS</span>
          <span className="font-semibold">{todaysBills.length}</span>
        </Card>
        <Card className="flex-1 flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-dim)]">CANCELLED</span>
          <span className="font-semibold">{cancelledBills.length}</span>
        </Card>
      </div>

      <div>
        <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
          TOTAL COLLECTED
        </p>
        <p className="text-3xl font-bold text-[var(--color-success)]">
          {formatMoney(totals.totalCollected, currency)}
        </p>
        <p className="text-xs text-[var(--color-text-dim)] mt-1">
          Bills + credit repayments + advances
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-[var(--color-text-dim)]">COLLECTED</p>
          <p className="text-lg font-bold text-[var(--color-success)] mt-1">
            {formatMoney(totals.collected, currency)}
          </p>
          <p className="text-xs text-[var(--color-text-faint)]">cash / UPI</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--color-text-dim)]">BILLED ON CREDIT</p>
          <p className="text-lg font-bold text-[var(--color-warning)] mt-1">
            {formatMoney(totals.billedOnCredit, currency)}
          </p>
          <p className="text-xs text-[var(--color-text-faint)]">on credit</p>
        </Card>
      </div>

      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search table, note, amount, customer"
          className="w-full rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] pl-9 pr-10 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"
        />
        <button
          onClick={() => setShowExpense(true)}
          className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full bg-[var(--color-primary)] text-white"
        >
          <SlidersHorizontal size={12} />
        </button>
      </div>

      <p className="text-sm text-[var(--color-text-dim)]">{filteredBills.length} bills in this view</p>

      <div className="space-y-2">
        {filteredBills.map((bill) => (
          <Card key={bill.id} onClick={() => setDetailBill(bill)} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {billPersonName(bill, customers.find((c) => c.id === bill.customerId))}
              </p>
              <p className="text-xs text-[var(--color-text-dim)]">
                {billPlace(bill)} ·{" "}
                {new Date(bill.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                ·{" "}
                {bill.status === "paid" && bill.amountPaid === 0
                  ? "on credit"
                  : bill.status === "paid"
                  ? "paid"
                  : bill.status}
              </p>
              {bill.matchParticipants && bill.matchParticipants.length > 1 && (
                <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
                  {bill.matchParticipants.join(" vs ")}
                  {bill.matchLosers && bill.matchLosers.length > 0 &&
                    ` · ${bill.matchLosers.join(", ")} lost`}
                </p>
              )}
            </div>
            <p className="text-sm font-semibold">{formatMoney(bill.total, currency)}</p>
          </Card>
        ))}
      </div>

      {expenses.length > 0 && (
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            EXPENSES TODAY
          </p>
          <div className="space-y-2">
            {expenses.slice(0, 5).map((e) => (
              <Card key={e.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{e.category}</p>
                  <p className="text-xs text-[var(--color-text-dim)]">{e.note}</p>
                </div>
                <p className="text-sm font-semibold text-[var(--color-danger)]">
                  -{formatMoney(e.amount, currency)}
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {showExpense && (
        <AddExpenseModal categories={categories} onAdd={addExpense} onClose={() => setShowExpense(false)} />
      )}
      {showCafeReport && <CafeReportModal onClose={() => setShowCafeReport(false)} />}
      {showGalla && <GallaSummaryModal onClose={() => setShowGalla(false)} />}
      {showInsights && <InsightsModal onClose={() => setShowInsights(false)} />}
      {showTableReport && <TableReportModal onClose={() => setShowTableReport(false)} />}
      {detailBill && <BillDetailModal bill={detailBill} onClose={() => setDetailBill(null)} />}
    </AppShell>
  );
}

// One table's whole day, time-wise: every session that ran on it, who played,
// when it started and ended, how much it came to, and whether it was paid or
// left on credit — so "kitna kamaya is table ne aaj" is one screen, not a
// scroll through every bill of the day.
function TableReportModal({ onClose }: { onClose: () => void }) {
  const bills = useBillsStore((s) => s.bills);
  const tables = useTablesStore((s) => s.tables);
  const customers = useCustomersStore((s) => s.customers);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const [detailBill, setDetailBill] = useState<Bill | null>(null);

  const ordered = useMemo(() => orderedTables(tables), [tables]);
  const [tableId, setTableId] = useState(ordered[0]?.id ?? "");
  const [date, setDate] = useState(() => toDateInputValue(Date.now()));

  const dayBills = useMemo(
    () =>
      bills
        .filter((b) => b.tableId === tableId && toDateInputValue(b.createdAt) === date)
        .sort((a, b) => a.createdAt - b.createdAt),
    [bills, tableId, date]
  );
  const dayTotal = dayBills
    .filter((b) => b.status !== "cancelled")
    .reduce((sum, b) => sum + b.total, 0);

  return (
    <Modal title="Table Report" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <select
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            className="flex-1 min-w-0 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          >
            {ordered.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            max={toDateInputValue(Date.now())}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
        </div>

        {dayBills.length === 0 ? (
          <p className="text-sm text-[var(--color-text-faint)] text-center py-8">
            No sessions on this table for this day.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-[var(--color-text-faint)]">
                    <th className="font-medium py-1.5 pr-2 whitespace-nowrap">Start</th>
                    <th className="font-medium py-1.5 pr-2 whitespace-nowrap">End</th>
                    <th className="font-medium py-1.5 pr-2">Players</th>
                    <th className="font-medium py-1.5 pr-2 text-right whitespace-nowrap">Amount</th>
                    <th className="font-medium py-1.5 pl-2 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dayBills.map((b) => {
                    const durationMs = b.tableChargeMinutes * 60000;
                    const start = b.createdAt - durationMs;
                    const customer = customers.find((c) => c.id === b.customerId);
                    const who = b.matchParticipants?.join(" vs ") ?? billPersonName(b, customer);
                    const status =
                      b.status === "cancelled"
                        ? "Cancelled"
                        : b.status === "open"
                          ? "Open"
                          : b.amountDue > 0
                            ? "Credit"
                            : "Paid";
                    return (
                      <tr
                        key={b.id}
                        onClick={() => setDetailBill(b)}
                        className={
                          "border-t border-[var(--color-border)] cursor-pointer" +
                          (b.status === "cancelled" ? " opacity-50" : "")
                        }
                      >
                        <td className="py-2 pr-2 whitespace-nowrap">{formatTime(start)}</td>
                        <td className="py-2 pr-2 whitespace-nowrap">{formatTime(b.createdAt)}</td>
                        <td className="py-2 pr-2">{who}</td>
                        <td className="py-2 pr-2 text-right font-medium whitespace-nowrap">
                          {formatMoney(b.total, currency)}
                        </td>
                        <td
                          className={
                            "py-2 pl-2 whitespace-nowrap " +
                            (status === "Paid"
                              ? "text-[var(--color-success)]"
                              : status === "Credit"
                                ? "text-[var(--color-warning)]"
                                : "text-[var(--color-text-faint)]")
                          }
                        >
                          {status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between text-sm font-semibold pt-2 border-t border-[var(--color-border)]">
              <span>
                Total · {dayBills.length} session{dayBills.length > 1 ? "s" : ""}
              </span>
              <span>{formatMoney(dayTotal, currency)}</span>
            </div>
          </>
        )}
      </div>
      {detailBill && <BillDetailModal bill={detailBill} onClose={() => setDetailBill(null)} />}
    </Modal>
  );
}

function GallaSummaryModal({ onClose }: { onClose: () => void }) {
  const bills = useBillsStore((s) => s.bills);
  const expenses = useExpensesStore((s) => s.expenses);
  const currency = useSettingsStore((s) => s.currencySymbol);

  const todaysActive = useMemo(
    () => bills.filter((b) => isToday(b.createdAt) && b.status !== "cancelled"),
    [bills]
  );
  const todaysExpenses = useMemo(() => expenses.filter((e) => isToday(e.createdAt)), [expenses]);

  const { cash, upi, credit: creditGiven } = useMemo(() => {
    let cash = 0;
    let upi = 0;
    let credit = 0;
    for (const b of todaysActive) {
      const m = billMoney(b);
      cash += m.cash;
      upi += m.upi;
      credit += m.credit;
    }
    return { cash, upi, credit };
  }, [todaysActive]);
  const expensesTotal = todaysExpenses.reduce((s, e) => s + e.amount, 0);
  const netCash = cash + upi - expensesTotal;

  return (
    <Modal title="Galla Summary" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="text-xs text-[var(--color-text-dim)]">Net cash in drawer</p>
          <p className="text-3xl font-bold text-[var(--color-primary)]">
            {formatMoney(netCash, currency)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">CASH</p>
            <p className="text-lg font-bold text-[var(--color-success)] mt-1">
              {formatMoney(cash, currency)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">UPI</p>
            <p className="text-lg font-bold text-[var(--color-success)] mt-1">
              {formatMoney(upi, currency)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">CREDIT GIVEN</p>
            <p className="text-lg font-bold text-[var(--color-warning)] mt-1">
              {formatMoney(creditGiven, currency)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">EXPENSES</p>
            <p className="text-lg font-bold text-[var(--color-danger)] mt-1">
              -{formatMoney(expensesTotal, currency)}
            </p>
          </Card>
        </div>

        {todaysExpenses.length > 0 && (
          <div>
            <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
              EXPENSES TODAY
            </p>
            <div className="space-y-2">
              {todaysExpenses.map((e) => (
                <Card key={e.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{e.category}</p>
                    <p className="text-xs text-[var(--color-text-dim)]">{e.note}</p>
                  </div>
                  <p className="text-sm font-semibold text-[var(--color-danger)]">
                    -{formatMoney(e.amount, currency)}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function InsightsModal({ onClose }: { onClose: () => void }) {
  const bills = useBillsStore((s) => s.bills);
  const games = useGamesStore((s) => s.games);
  const currency = useSettingsStore((s) => s.currencySymbol);

  const last7Days = useMemo(() => {
    const days: { label: string; total: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayTotal = bills
        .filter((b) => {
          if (b.status === "cancelled") return false;
          const bd = new Date(b.createdAt);
          return (
            bd.getFullYear() === d.getFullYear() &&
            bd.getMonth() === d.getMonth() &&
            bd.getDate() === d.getDate()
          );
        })
        .reduce((s, b) => s + billCollected(b), 0);
      days.push({ label: d.toLocaleDateString([], { weekday: "short" }), total: dayTotal });
    }
    return days;
  }, [bills]);

  const maxDay = Math.max(1, ...last7Days.map((d) => d.total));

  const topGames = useMemo(() => {
    const byGame = new Map<string, number>();
    bills
      .filter((b) => isThisMonth(b.createdAt) && b.status === "paid" && b.gameId)
      .forEach((b) => byGame.set(b.gameId!, (byGame.get(b.gameId!) ?? 0) + b.total));
    return Array.from(byGame.entries())
      .map(([gameId, revenue]) => ({ game: games.find((g) => g.id === gameId), revenue }))
      .filter((r) => r.game)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3);
  }, [bills, games]);

  const topTables = useMemo(() => {
    const byTable = new Map<string, { name: string; count: number; revenue: number }>();
    bills
      .filter((b) => isThisMonth(b.createdAt) && b.status === "paid" && b.tableId)
      .forEach((b) => {
        const key = b.tableId!;
        const cur = byTable.get(key) ?? { name: b.tableName ?? "Table", count: 0, revenue: 0 };
        cur.count += 1;
        cur.revenue += b.total;
        byTable.set(key, cur);
      });
    return Array.from(byTable.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3);
  }, [bills]);

  return (
    <Modal title="Insights" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-3">
            LAST 7 DAYS
          </p>
          <div className="flex items-end justify-between gap-2 h-32">
            {last7Days.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="text-[10px] text-[var(--color-text-faint)]">
                  {d.total > 0 ? formatMoney(d.total, currency) : ""}
                </span>
                <div
                  className="w-full rounded-t-md bg-[var(--color-primary)]"
                  style={{ height: `${Math.max(4, (d.total / maxDay) * 96)}px` }}
                />
                <span className="text-[10px] text-[var(--color-text-faint)]">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            TOP GAMES THIS MONTH
          </p>
          {topGames.length === 0 ? (
            <p className="text-sm text-[var(--color-text-faint)]">No game sessions billed yet.</p>
          ) : (
            <div className="space-y-2">
              {topGames.map(({ game, revenue }) => (
                <Card key={game!.id} className="flex items-center justify-between">
                  <p className="text-sm font-medium">{game!.name}</p>
                  <p className="text-sm font-semibold">{formatMoney(revenue, currency)}</p>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            TOP TABLES THIS MONTH
          </p>
          {topTables.length === 0 ? (
            <p className="text-sm text-[var(--color-text-faint)]">No sessions billed yet.</p>
          ) : (
            <div className="space-y-2">
              {topTables.map((t) => (
                <Card key={t.name} className="flex items-center justify-between">
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-sm font-semibold">
                    {formatMoney(t.revenue, currency)}{" "}
                    <span className="text-[var(--color-text-faint)] font-normal">
                      · {t.count} session{t.count > 1 ? "s" : ""}
                    </span>
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CafeReportModal({ onClose }: { onClose: () => void }) {
  const orders = useOrdersStore((s) => s.orders);
  const items = useMenuStore((s) => s.items);
  const categories = useMenuStore((s) => s.categories);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const storeName = useSettingsStore((s) => s.storeName);
  const [period, setPeriod] = useState<"today" | "month">("today");
  const [working, setWorking] = useState(false);

  const rows = useMemo(() => {
    return items.map((item) => {
      let todayQty = 0;
      let todayRevenue = 0;
      let monthQty = 0;
      let monthRevenue = 0;
      for (const order of orders) {
        const line = order.items.find((i) => i.menuItemId === item.id);
        if (!line) continue;
        if (isToday(order.createdAt)) {
          todayQty += line.qty;
          todayRevenue += line.qty * line.price;
        }
        if (isThisMonth(order.createdAt)) {
          monthQty += line.qty;
          monthRevenue += line.qty * line.price;
        }
      }
      // What's left right now, and — worked backwards from that — roughly how
      // much there was to start the period, assuming nothing but sales moved
      // the number (a restock partway through the period would throw this
      // off, since there's no separate purchase log to account for it).
      const remaining = item.stockQty;
      const used = period === "today" ? todayQty : monthQty;
      const revenue = period === "today" ? todayRevenue : monthRevenue;
      const opening = remaining != null ? remaining + used : null;
      const valueRemaining = remaining != null ? remaining * item.price : null;
      // Real profit — only when a cost price has actually been entered for
      // this item (Settings → Menu Management). Otherwise there's nothing to
      // subtract from revenue, so profit stays unknown rather than a guess.
      const costUsed = item.costPrice != null ? used * item.costPrice : null;
      const profit = item.costPrice != null ? revenue - costUsed! : null;
      const valueRemainingAtCost =
        remaining != null && item.costPrice != null ? remaining * item.costPrice : null;
      return {
        item,
        todayQty,
        monthQty,
        monthRevenue,
        opening,
        used,
        remaining,
        revenue,
        valueRemaining,
        costUsed,
        profit,
        valueRemainingAtCost,
      };
    });
  }, [items, orders, period]);

  const lowStock = items.filter((i) => i.stockQty != null && i.stockQty <= i.lowStockThreshold);

  async function handleDownload() {
    setWorking(true);
    try {
      // Loaded on demand, same as the full data export in Settings — this
      // library only costs anything the moment someone actually taps download.
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const periodLabel = period === "today" ? "Today" : "This Month";
      const stockRows = rows.map(
        ({ item, opening, used, remaining, revenue, valueRemaining, costUsed, profit, valueRemainingAtCost }) => ({
          Item: item.name,
          Category: categories.find((c) => c.id === item.categoryId)?.name ?? "",
          "Price/unit": item.price,
          "Cost/unit": item.costPrice ?? "not set",
          Tracked: item.stockQty != null ? "Yes" : "No",
          [`Opening (${periodLabel})`]: opening ?? "not tracked",
          [`Used/Sold (${periodLabel})`]: used,
          "Remaining now": remaining ?? "not tracked",
          [`Revenue (${periodLabel})`]: revenue,
          [`Cost of goods used (${periodLabel})`]: costUsed ?? "not set",
          [`Profit (${periodLabel})`]: profit ?? "not set",
          "Value remaining (at price)": valueRemaining ?? "not tracked",
          "Value remaining (at cost)": valueRemainingAtCost ?? "not set",
          "Low stock?": item.stockQty != null && item.stockQty <= item.lowStockThreshold ? "Yes" : "No",
        })
      );
      const sheet = XLSX.utils.json_to_sheet(stockRows);
      XLSX.utils.book_append_sheet(wb, sheet, "Stock");
      XLSX.writeFile(
        wb,
        `${storeName.replace(/[^a-z0-9]+/gi, "-") || "cuebill"}-stock-${period}-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal title="Cafe Report" onClose={onClose}>
      <div className="space-y-4">
        {lowStock.length > 0 && (
          <Card className="border-[var(--color-danger)]/40">
            <p className="text-xs font-semibold text-[var(--color-danger)] mb-1">LOW STOCK</p>
            <p className="text-sm text-[var(--color-text-dim)]">
              {lowStock.map((i) => `${i.name} (${i.stockQty})`).join(", ")}
            </p>
          </Card>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)]">
              STOCK REPORT
            </p>
            <div className="flex rounded-lg bg-[var(--color-surface-2)] p-0.5">
              <button
                onClick={() => setPeriod("today")}
                className={
                  "px-2.5 py-1 text-xs font-medium rounded-md " +
                  (period === "today" ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-text-dim)]")
                }
              >
                Today
              </button>
              <button
                onClick={() => setPeriod("month")}
                className={
                  "px-2.5 py-1 text-xs font-medium rounded-md " +
                  (period === "month" ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-text-dim)]")
                }
              >
                This month
              </button>
            </div>
          </div>
          <p className="text-xs text-[var(--color-text-faint)] -mt-1 mb-2">
            Profit shows only for items with a cost price set (Settings → Menu Management). For
            the rest, "Value" is just worth-at-menu-price, not profit.
          </p>

          <button
            onClick={handleDownload}
            disabled={working}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] disabled:opacity-60 text-white font-semibold py-2.5 mb-3"
          >
            <FileSpreadsheet size={15} /> {working ? "Preparing…" : "Download Stock Excel"}
          </button>

          <div className="space-y-2">
            {rows.map(({ item, opening, used, remaining, revenue, profit }) => (
              <Card key={item.id}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{item.name}</p>
                  <span className="text-xs text-[var(--color-text-dim)]">
                    {remaining == null ? "not tracked" : `${remaining} in stock`}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-2 pt-2 border-t border-[var(--color-border)] text-center">
                  <div>
                    <p className="text-[10px] text-[var(--color-text-faint)]">Opening</p>
                    <p className="text-sm font-semibold">{opening ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-text-faint)]">Used</p>
                    <p className="text-sm font-semibold">{used}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-text-faint)]">Left</p>
                    <p className="text-sm font-semibold">{remaining ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-text-faint)]">
                      {profit != null ? "Profit" : "Value used"}
                    </p>
                    <p
                      className={
                        "text-sm font-semibold " + (profit != null ? "text-[var(--color-success)]" : "")
                      }
                    >
                      {formatMoney(profit ?? revenue, currency)}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function AddExpenseModal({
  categories,
  onAdd,
  onClose,
}: {
  categories: string[];
  onAdd: (data: { category: string; amount: number; note: string }) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(categories[0]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  function handleSave() {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    onAdd({ category, amount: amt, note });
    onClose();
  }

  return (
    <Modal title="Add expense" onClose={onClose}>
      <div className="space-y-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
        />
        <button
          onClick={handleSave}
          className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
        >
          Save expense
        </button>
      </div>
    </Modal>
  );
}
