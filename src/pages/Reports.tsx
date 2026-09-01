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
import { useCustomersStore } from "../store/useCustomersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, formatDuration, formatDateTime, isToday, isThisMonth, toDateInputValue } from "../lib/format";
import { billMoney, billCollected, billRemaining } from "../lib/billing";
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
  Check,
  X,
  Trophy,
  Frown,
} from "lucide-react";

export function Reports() {
  const bills = useBillsStore((s) => s.bills);
  const tables = useTablesStore((s) => s.tables);
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

  const filteredBills = todaysBills.filter((b) =>
    (b.tableName ?? "").toLowerCase().includes(search.toLowerCase())
  );

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
              <p className="text-sm font-medium">{bill.tableName ?? "Canteen order"}</p>
              <p className="text-xs text-[var(--color-text-dim)]">
                {new Date(bill.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {bill.status}
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
      {detailBill && <BillDetailModal bill={detailBill} onClose={() => setDetailBill(null)} />}
    </AppShell>
  );
}

// Full breakdown of one session: when it started, when it ended, what was
// ordered, and who won/lost — everything the owner needs without having to
// remember or ask.
function BillDetailModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
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
  const currency = useSettingsStore((s) => s.currencySymbol);

  const rows = useMemo(() => {
    return items.map((item) => {
      let todayQty = 0;
      let monthQty = 0;
      let monthRevenue = 0;
      for (const order of orders) {
        const line = order.items.find((i) => i.menuItemId === item.id);
        if (!line) continue;
        if (isToday(order.createdAt)) todayQty += line.qty;
        if (isThisMonth(order.createdAt)) {
          monthQty += line.qty;
          monthRevenue += line.qty * line.price;
        }
      }
      return { item, todayQty, monthQty, monthRevenue };
    });
  }, [items, orders]);

  const lowStock = items.filter((i) => i.stockQty != null && i.stockQty <= i.lowStockThreshold);

  return (
    <Modal title="Cafe Report" onClose={onClose}>
      {lowStock.length > 0 && (
        <Card className="border-[var(--color-danger)]/40 mb-3">
          <p className="text-xs font-semibold text-[var(--color-danger)] mb-1">LOW STOCK</p>
          <p className="text-sm text-[var(--color-text-dim)]">
            {lowStock.map((i) => `${i.name} (${i.stockQty})`).join(", ")}
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {rows.map(({ item, todayQty, monthQty, monthRevenue }) => (
          <Card key={item.id}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{item.name}</p>
              <span className="text-xs text-[var(--color-text-dim)]">
                {item.stockQty == null ? "not tracked" : `${item.stockQty} in stock`}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-[var(--color-border)] text-center">
              <div>
                <p className="text-xs text-[var(--color-text-faint)]">Today</p>
                <p className="text-sm font-semibold">{todayQty}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-faint)]">This month</p>
                <p className="text-sm font-semibold">{monthQty}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-faint)]">Revenue</p>
                <p className="text-sm font-semibold">{formatMoney(monthRevenue, currency)}</p>
              </div>
            </div>
          </Card>
        ))}
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
