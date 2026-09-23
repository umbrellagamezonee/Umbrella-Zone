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
import {
  formatMoney,
  formatTime,
  formatDateTime,
  isToday,
  isThisMonth,
  toDateInputValue,
  formatDateKey,
  IST_TIME_ZONE,
} from "../lib/format";
import { billMoney, billCollected, billRemaining, REPORT_CATEGORIES, dailyCollectionRows } from "../lib/billing";
import { billPersonName, billPlace } from "../lib/billLabel";
import { useCustomersStore } from "../store/useCustomersStore";
import { orderedTables } from "../store/useTablesStore";
import { BillDetailModal } from "../components/BillDetailModal";
import type { Bill, Expense } from "../types";
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
  Pencil,
  Trash2,
  Plus,
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
  const [showMonthlyReport, setShowMonthlyReport] = useState(false);
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

      <Card onClick={() => setShowMonthlyReport(true)}>
        <div className="flex items-center gap-2 text-[var(--color-primary)]">
          <FileSpreadsheet size={16} />
          <p className="text-sm font-semibold">Monthly Report</p>
        </div>
        <p className="text-xs text-[var(--color-text-faint)] mt-1">
          Table, Food, Drinks, Cigarette, Chocolate — collection, expense, profit, ek Excel mein
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
          <p className="text-xs text-[var(--color-text-faint)]">cash / account</p>
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
          placeholder="Search table, customer, players"
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
                {formatTime(bill.createdAt)}{" "}
                ·{" "}
                {bill.status === "paid" && bill.amountPaid === 0
                  ? "on credit"
                  : bill.status === "paid"
                  ? "paid"
                  : bill.status}
              </p>
              {bill.matchParticipants && bill.matchParticipants.length > 1 && (
                <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
                  {bill.gameName ? `${bill.gameName} · ` : ""}
                  {bill.matchParticipants.join(" vs ")}
                  {bill.matchLosers && bill.matchLosers.length > 0 &&
                    ` · ${bill.matchLosers.join(", ")} lost`}
                </p>
              )}
              {bill.gameName && (!bill.matchParticipants || bill.matchParticipants.length <= 1) && (
                <p className="text-xs text-[var(--color-text-faint)] mt-0.5">{bill.gameName}</p>
              )}
              {bill.canteenItems.length > 0 && (
                <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
                  {bill.canteenItems.map((i) => `${i.name} x${i.qty}`).join(", ")}
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
      {showMonthlyReport && <MonthlyReportModal onClose={() => setShowMonthlyReport(false)} />}
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
                    const timeUnknown = b.tableCharge > 0 && b.tableChargeMinutes <= 0;
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
                        {timeUnknown ? (
                          <td
                            className="py-2 pr-2 whitespace-nowrap text-[var(--color-text-faint)]"
                            colSpan={2}
                          >
                            Time not recorded
                          </td>
                        ) : (
                          <>
                            <td className="py-2 pr-2 whitespace-nowrap">{formatTime(start)}</td>
                            <td className="py-2 pr-2 whitespace-nowrap">{formatTime(b.createdAt)}</td>
                          </>
                        )}
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

function MonthlyReportModal({ onClose }: { onClose: () => void }) {
  const bills = useBillsStore((s) => s.bills);
  const orders = useOrdersStore((s) => s.orders);
  const expenses = useExpensesStore((s) => s.expenses);
  const menuItems = useMenuStore((s) => s.items);
  const menuCategories = useMenuStore((s) => s.categories);
  const tables = useTablesStore((s) => s.tables);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const storeName = useSettingsStore((s) => s.storeName);
  const [working, setWorking] = useState(false);
  // Which category's Purchase figure is being edited right now — opens a
  // list of this month's expense entries for just that category, since
  // Purchase is a sum of however many of those there are, not one number.
  const [editCategory, setEditCategory] = useState<string | null>(null);

  const monthBills = useMemo(
    () => bills.filter((b) => isThisMonth(b.createdAt) && b.status !== "cancelled"),
    [bills]
  );
  const monthOrders = useMemo(() => orders.filter((o) => isThisMonth(o.createdAt)), [orders]);
  const monthExpenses = useMemo(() => expenses.filter((e) => isThisMonth(e.createdAt)), [expenses]);
  const expenseFor = (category: string) =>
    monthExpenses.filter((e) => e.category === category).reduce((s, e) => s + e.amount, 0);

  const orderedTablesList = useMemo(() => orderedTables(tables), [tables]);
  const tableRows = orderedTablesList.map((t) => ({
    name: t.name,
    collection: monthBills.filter((b) => b.tableId === t.id).reduce((s, b) => s + b.tableCharge, 0),
  }));
  const totalTableCollection = tableRows.reduce((s, r) => s + r.collection, 0);
  const tableExpense = expenseFor("Table");
  const netTableIncome = totalTableCollection - tableExpense;

  // Per-item detail (price, cost, margin, qty sold, revenue, what's still in
  // stock) — the category totals below are just these rows added up, but the
  // owner wants to see each item on its own line, like a ledger, not just
  // one number for the whole category.
  const categoryTotals = REPORT_CATEGORIES.map((rc) => {
    const catId = menuCategories.find((c) => c.name === rc.categoryName)?.id;
    const catItems = menuItems.filter((i) => i.categoryId === catId);
    const itemRows = catItems.map((item) => {
      let qtySold = 0;
      for (const order of monthOrders) {
        const line = order.items.find((i) => i.menuItemId === item.id);
        if (line) qtySold += line.qty;
      }
      const revenue = qtySold * item.price;
      const marginPerUnit = item.costPrice != null ? item.price - item.costPrice : null;
      const remainingQty = item.stockQty;
      const remainingValue = remainingQty != null ? remainingQty * item.price : null;
      return {
        id: item.id,
        name: item.name,
        price: item.price,
        costPrice: item.costPrice,
        marginPerUnit,
        qtySold,
        revenue,
        remainingQty,
        remainingValue,
      };
    });
    const sale = itemRows.reduce((s, r) => s + r.revenue, 0);
    const remaining = itemRows.reduce((s, r) => s + (r.remainingValue ?? 0), 0);
    const purchase = expenseFor(rc.sheet.replace(" collection", ""));
    return { ...rc, sale, purchase, profit: sale - purchase, remaining, itemCount: catItems.length, itemRows };
  });
  const totalSale = categoryTotals.reduce((s, c) => s + c.sale, 0);
  const totalPurchase = categoryTotals.reduce((s, c) => s + c.purchase, 0);
  const totalCollection = totalTableCollection + totalSale;
  const totalExpense = tableExpense + totalPurchase;
  const netIncome = totalCollection - totalExpense;

  async function handleDownload() {
    setWorking(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const round = (n: number) => Math.round(n * 100) / 100;
      const monthLabel = new Date().toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: IST_TIME_ZONE,
      });

      // A plain round-number sheet (no decimals-heavy noise, sensible column
      // widths so nothing gets clipped) reads like a real report instead of
      // a raw data dump — the whole point of asking for this over the
      // existing full export.
      function addSheet<T extends Record<string, string | number>>(name: string, rows: T[], widths: number[]) {
        const ws = XLSX.utils.json_to_sheet(rows);
        ws["!cols"] = widths.map((wch) => ({ wch }));
        XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
      }

      addSheet(
        "Table collection",
        [
          { Table: `${storeName} — ${monthLabel}`, Collection: "" },
          { Table: "", Collection: "" },
          ...tableRows.map((r) => ({ Table: r.name, Collection: round(r.collection) })),
          { Table: "Total collection", Collection: round(totalTableCollection) },
          { Table: "Table expense", Collection: round(tableExpense) },
          { Table: "Net table income", Collection: round(netTableIncome) },
        ],
        [24, 16]
      );

      for (const c of categoryTotals) {
        type ItemRow = Record<string, string | number>;
        const blank: ItemRow = { Item: "", Price: "", Cost: "", Margin: "", Sold: "", Revenue: "", "In stock": "", "Stock value": "" };
        const itemSheetRows: ItemRow[] = [
          { Item: `${storeName} — ${monthLabel}`, Price: "", Cost: "", Margin: "", Sold: "", Revenue: "", "In stock": "", "Stock value": "" },
          blank,
          ...c.itemRows
            .slice()
            .sort((a, b) => b.revenue - a.revenue)
            .map((r) => ({
              Item: r.name,
              Price: round(r.price),
              Cost: r.costPrice != null ? round(r.costPrice) : "—",
              Margin: r.marginPerUnit != null ? round(r.marginPerUnit) : "—",
              Sold: r.qtySold,
              Revenue: round(r.revenue),
              "In stock": r.remainingQty ?? "—",
              "Stock value": r.remainingValue != null ? round(r.remainingValue) : "—",
            })),
          blank,
          { Item: "Total sale", Price: "", Cost: "", Margin: "", Sold: "", Revenue: round(c.sale), "In stock": "", "Stock value": round(c.remaining) },
          { Item: "Purchase", Price: "", Cost: "", Margin: "", Sold: "", Revenue: round(c.purchase), "In stock": "", "Stock value": "" },
          { Item: "Profit", Price: "", Cost: "", Margin: "", Sold: "", Revenue: round(c.profit), "In stock": "", "Stock value": "" },
        ];
        addSheet(c.sheet, itemSheetRows, [26, 9, 9, 9, 7, 10, 9, 11]);
      }

      addSheet("Daily collection", dailyCollectionRows(monthBills, menuItems, menuCategories, orderedTablesList), [
        16, 16, 16, 12, 12,
      ]);

      // One clean table instead of a long flat list — Section / Collection /
      // Expense / Net, same shape for the table row and every category, so
      // it reads at a glance instead of needing to hunt for each figure.
      addSheet(
        "TOTAL",
        [
          { Section: `${storeName} — ${monthLabel}`, Collection: "", Expense: "", Net: "" },
          { Section: "", Collection: "", Expense: "", Net: "" },
          { Section: "Table", Collection: round(totalTableCollection), Expense: round(tableExpense), Net: round(netTableIncome) },
          ...categoryTotals.map((c) => ({
            Section: c.sheet.replace(" collection", ""),
            Collection: round(c.sale),
            Expense: round(c.purchase),
            Net: round(c.profit),
          })),
          { Section: "", Collection: "", Expense: "", Net: "" },
          { Section: "Total", Collection: round(totalCollection), Expense: round(totalExpense), Net: round(netIncome) },
        ],
        [16, 14, 14, 14]
      );

      XLSX.writeFile(
        wb,
        `${storeName.replace(/[^a-z0-9]+/gi, "-") || "cuebill"}-monthly-report-${new Date()
          .toISOString()
          .slice(0, 7)}.xlsx`
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal title="Monthly Report" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--color-text-faint)]">
          Is mahine ka data. "Purchase" Settings → Expenses mein Table/Food/Drinks/Cigarette/
          Chocolate category se dale gaye kharch se aata hai — jab tak wahan kharch daalna shuru
          nahi karoge, Purchase aur Profit ₹0 dikhenge.
        </p>

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            TABLE COLLECTION
          </p>
          <Card>
            <div className="flex justify-between text-sm py-1">
              <span className="text-[var(--color-text-dim)]">Total collection</span>
              <span className="font-semibold">{formatMoney(totalTableCollection, currency)}</span>
            </div>
            <div className="flex justify-between items-center text-sm py-1">
              <span className="text-[var(--color-text-dim)]">Table expense</span>
              <span className="flex items-center gap-1.5">
                {formatMoney(tableExpense, currency)}
                <button
                  onClick={() => setEditCategory("Table")}
                  className="text-[var(--color-text-faint)]"
                  title="Edit Table expenses"
                >
                  <Pencil size={12} />
                </button>
              </span>
            </div>
            <div className="flex justify-between text-sm py-1 border-t border-[var(--color-border)] mt-1 pt-2 font-semibold">
              <span>Net table income</span>
              <span className="text-[var(--color-success)]">{formatMoney(netTableIncome, currency)}</span>
            </div>
          </Card>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            FOOD · DRINKS · CIGARETTE · CHOCOLATE
          </p>
          <div className="space-y-2">
            {categoryTotals.map((c) => (
              <Card key={c.sheet}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{c.sheet}</p>
                  <span className="text-xs text-[var(--color-text-faint)]">{c.itemCount} items</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-[var(--color-border)] text-center">
                  <div>
                    <p className="text-[10px] text-[var(--color-text-faint)]">Sale</p>
                    <p className="text-sm font-semibold">{formatMoney(c.sale, currency)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-text-faint)]">Purchase</p>
                    <p className="text-sm font-semibold flex items-center justify-center gap-1.5">
                      {formatMoney(c.purchase, currency)}
                      <button
                        onClick={() => setEditCategory(c.sheet.replace(" collection", ""))}
                        className="text-[var(--color-text-faint)]"
                        title={`Edit ${c.sheet.replace(" collection", "")} expenses`}
                      >
                        <Pencil size={12} />
                      </button>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-text-faint)]">Profit</p>
                    <p className="text-sm font-semibold text-[var(--color-success)]">
                      {formatMoney(c.profit, currency)}
                    </p>
                  </div>
                </div>
                {c.itemRows.length > 0 && (
                  <details className="mt-2 pt-2 border-t border-[var(--color-border)]">
                    <summary className="text-xs text-[var(--color-primary)] cursor-pointer select-none">
                      Item-by-item (ledger)
                    </summary>
                    <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
                      {c.itemRows
                        .slice()
                        .sort((a, b) => b.revenue - a.revenue)
                        .map((r) => (
                          <div key={r.id} className="text-xs flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate">{r.name}</span>
                            <span className="text-[var(--color-text-faint)] shrink-0 whitespace-nowrap">
                              {formatMoney(r.price, currency)} ·{" "}
                              {r.marginPerUnit != null
                                ? `${formatMoney(r.marginPerUnit, currency)} margin`
                                : "no cost set"}{" "}
                              · sold {r.qtySold} · {r.remainingQty ?? "—"} pending
                            </span>
                          </div>
                        ))}
                    </div>
                  </details>
                )}
              </Card>
            ))}
          </div>
        </div>

        <Card className="border-[var(--color-primary)]/40">
          <div className="flex justify-between text-sm py-1">
            <span className="text-[var(--color-text-dim)]">Total collection</span>
            <span className="font-semibold">{formatMoney(totalCollection, currency)}</span>
          </div>
          <div className="flex justify-between text-sm py-1">
            <span className="text-[var(--color-text-dim)]">Total expense</span>
            <span>{formatMoney(totalExpense, currency)}</span>
          </div>
          <div className="flex justify-between text-sm py-1 border-t border-[var(--color-border)] mt-1 pt-2 font-semibold">
            <span>Net income</span>
            <span className="text-[var(--color-success)]">{formatMoney(netIncome, currency)}</span>
          </div>
        </Card>

        <button
          onClick={handleDownload}
          disabled={working}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] disabled:opacity-60 text-white font-semibold py-3"
        >
          <FileSpreadsheet size={16} /> {working ? "Preparing…" : "Download Monthly Report Excel"}
        </button>
      </div>

      {editCategory && (
        <CategoryExpensesModal
          category={editCategory}
          expenses={monthExpenses.filter((e) => e.category === editCategory)}
          onClose={() => setEditCategory(null)}
        />
      )}
    </Modal>
  );
}

// This month's expense entries for one category — Purchase on the report
// above is just these added up, but staff correct/add to it one entry at a
// time, not as a single lump number.
function CategoryExpensesModal({
  category,
  expenses,
  onClose,
}: {
  category: string;
  expenses: Expense[];
  onClose: () => void;
}) {
  const currency = useSettingsStore((s) => s.currencySymbol);
  const addExpense = useExpensesStore((s) => s.addExpense);
  const updateExpense = useExpensesStore((s) => s.updateExpense);
  const removeExpense = useExpensesStore((s) => s.removeExpense);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  const sorted = [...expenses].sort((a, b) => b.createdAt - a.createdAt);
  const total = sorted.reduce((s, e) => s + e.amount, 0);

  function startEdit(e: Expense) {
    setEditingId(e.id);
    setAmount(String(e.amount));
    setNote(e.note);
    setAdding(false);
  }
  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setAmount("");
    setNote("");
  }
  function cancel() {
    setEditingId(null);
    setAdding(false);
  }
  function save() {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    if (adding) {
      addExpense({ category, amount: amt, note });
    } else if (editingId) {
      updateExpense(editingId, { category, amount: amt, note });
    }
    cancel();
  }

  return (
    <Modal title={`${category} expenses this month`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex justify-between text-sm font-semibold">
          <span>Total (Purchase)</span>
          <span>{formatMoney(total, currency)}</span>
        </div>

        {sorted.length === 0 && !adding && (
          <p className="text-sm text-[var(--color-text-faint)] text-center py-4">
            Is mahine {category} mein koi expense nahi daala gaya.
          </p>
        )}

        <div className="space-y-2">
          {sorted.map((e) =>
            editingId === e.id ? (
              <Card key={e.id}>
                <div className="space-y-2">
                  <input
                    type="number"
                    min={0}
                    value={amount}
                    onChange={(ev) => setAmount(ev.target.value)}
                    placeholder="Amount"
                    className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-sm outline-none"
                  />
                  <input
                    value={note}
                    onChange={(ev) => setNote(ev.target.value)}
                    placeholder="Note (optional)"
                    className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-sm outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={save}
                      className="flex-1 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold py-2"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancel}
                      className="flex-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm font-medium py-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card key={e.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{formatMoney(e.amount, currency)}</p>
                  <p className="text-xs text-[var(--color-text-faint)] truncate">
                    {e.note || "No note"} · {formatDateTime(e.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(e)}
                    className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-surface-2)]"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => removeExpense(e.id)}
                    className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            )
          )}
        </div>

        {adding ? (
          <Card>
            <div className="space-y-2">
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                autoFocus
                className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-sm outline-none"
              />
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note (optional)"
                className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-sm outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={save}
                  className="flex-1 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold py-2"
                >
                  Save
                </button>
                <button
                  onClick={cancel}
                  className="flex-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm font-medium py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          </Card>
        ) : (
          <button
            onClick={startAdd}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm font-medium py-2.5"
          >
            <Plus size={14} /> Add {category} expense
          </button>
        )}
      </div>
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
            <p className="text-xs text-[var(--color-text-dim)]">ACCOUNT</p>
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
      const dayKey = toDateInputValue(Date.now() - i * 86_400_000);
      const dayTotal = bills
        .filter((b) => b.status !== "cancelled" && toDateInputValue(b.createdAt) === dayKey)
        .reduce((s, b) => s + billCollected(b), 0);
      days.push({ label: formatDateKey(dayKey, { weekday: "short" }), total: dayTotal });
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
