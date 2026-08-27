import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { TableCard } from "../components/TableCard";
import { StartSessionModal } from "../components/StartSessionModal";
import { useTablesStore } from "../store/useTablesStore";
import { useBillsStore } from "../store/useBillsStore";
import { useExpensesStore } from "../store/useExpensesStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, isToday, isThisMonth, toDateInputValue } from "../lib/format";
import { billCollected, billRemaining } from "../lib/billing";
import { useNow } from "../lib/useNow";
import { Bed, CalendarDays } from "lucide-react";

export function Home() {
  const tables = useTablesStore((s) => s.tables);
  const bills = useBillsStore((s) => s.bills);
  const expenses = useExpensesStore((s) => s.expenses);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const now = useNow();
  const [startTableId, setStartTableId] = useState<string | null>(null);
  const [checkDate, setCheckDate] = useState(() => toDateInputValue(Date.now()));

  const startTable = tables.find((t) => t.id === startTableId) || null;
  // Home is just for starting a fresh session — once a table is running/paused,
  // it's managed from the Sessions page instead of cluttering this list.
  const availableTables = tables.filter((t) => t.status === "available");

  const todaysBills = useMemo(() => bills.filter((b) => isToday(b.createdAt)), [bills]);
  const monthBills = useMemo(() => bills.filter((b) => isThisMonth(b.createdAt)), [bills]);

  const collectedToday = useMemo(
    () =>
      todaysBills
        .filter((b) => b.status !== "cancelled")
        .reduce((sum, b) => sum + billCollected(b), 0),
    [todaysBills]
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
  const available = availableTables.length;
  const openBills = bills.filter((b) => b.status === "open");
  const openBillsTotal = openBills.reduce((sum, b) => sum + billRemaining(b), 0);
  const activeCount = running + paused;

  return (
    <AppShell title="Home">
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

      <div>
        <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
          TABLES
        </p>
        <div className="space-y-3">
          {availableTables.map((table) => (
            <TableCard
              key={table.id}
              table={table}
              now={now}
              onOpenDetail={() => {}}
              onStart={(t) => setStartTableId(t.id)}
            />
          ))}
          {tables.length === 0 && (
            <p className="text-center text-sm text-[var(--color-text-faint)] py-6">
              No tables yet — add some in Settings → Table Management.
            </p>
          )}
          {tables.length > 0 && availableTables.length === 0 && (
            <p className="text-center text-sm text-[var(--color-text-faint)] py-6">
              Every table's in use — check Sessions to manage them.
            </p>
          )}
        </div>
      </div>

      {startTable && (
        <StartSessionModal table={startTable} onClose={() => setStartTableId(null)} />
      )}
    </AppShell>
  );
}
