import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { useCustomersStore } from "../store/useCustomersStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useBillsStore } from "../store/useBillsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, toDateInputValue } from "../lib/format";
import { creditBalanceFor, customerOpenBills, customerPendingOrders, orderTotal } from "../lib/billing";
import { creditByBusinessForAll } from "../lib/ledger";
import { customerLabel, normalizeName } from "../lib/customerName";
import { CustomerDetailModal, SettleCreditModal } from "./Customers";
import { HisaabReport } from "../components/HisaabReport";
import type { Customer } from "../types";
import { Wallet, Search, CalendarDays } from "lucide-react";

// Everyone who owes money. Credit is only ever added when a bill is made (at
// checkout), so the one thing to do from here is Settle — take a payment
// against what they owe. "Owed" here is credit already on the books PLUS any
// served-but-not-yet-billed canteen orders, so this matches what that
// customer's own profile shows as their total. Each customer's amount is shown
// split into gaming and canteen, like a proper ledger.
export function Credits() {
  const customers = useCustomersStore((s) => s.customers);
  const orders = useOrdersStore((s) => s.orders);
  const bills = useBillsStore((s) => s.bills);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const [settleCustomer, setSettleCustomer] = useState<Customer | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");
  const [showMonthly, setShowMonthly] = useState(false);

  // "Not billed yet" here covers two things that are both real money owed
  // but not yet in creditBalance: served-but-unbilled canteen orders, and
  // bills that already got created (Stop & Bill / "Bill this order") but got
  // left stuck "open" — checkout started, never finished. Without the second
  // half, a customer whose whole debt was stuck in one of those bills
  // wouldn't even show up on this page at all.
  const pendingTotalFor = (customerId: string) =>
    customerPendingOrders(orders, bills, customerId).reduce((sum, o) => sum + orderTotal(o), 0) +
    customerOpenBills(bills, customerId).reduce((sum, b) => sum + b.amountDue, 0);

  // Opening Settle only shows the total — billed credit plus anything served
  // but not yet billed. Nothing is changed until a payment is actually
  // recorded (see SettleCreditModal / billPendingToCredit), so opening it
  // and backing out leaves the customer's account exactly as it was.
  function handleSettleClick(c: Customer) {
    const fresh = useCustomersStore.getState().customers.find((x) => x.id === c.id) ?? c;
    setSettleCustomer(fresh);
  }

  const dueCustomers = useMemo(() => {
    const splits = creditByBusinessForAll(customers, bills, orders);
    return (
      customers
        .filter((c) => !c.isWalkIn)
        .map((c) => ({
          customer: c,
          creditBalance: creditBalanceFor(bills, c.id, normalizeName(c.name)),
          pendingTotal: pendingTotalFor(c.id),
        }))
        .filter(({ creditBalance, pendingTotal }) => creditBalance > 0 || pendingTotal > 0)
        .map((row) => ({ ...row, split: splits.get(row.customer.id) ?? { gaming: 0, canteen: 0 } }))
        .sort((a, b) => (b.creditBalance + b.pendingTotal) - (a.creditBalance + a.pendingTotal))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, bills, orders]);
  const totalDue = dueCustomers.reduce((sum, { creditBalance, pendingTotal }) => sum + creditBalance + pendingTotal, 0);
  const totalGaming = dueCustomers.reduce((sum, { split }) => sum + split.gaming, 0);
  const totalCanteen = dueCustomers.reduce((sum, { split }) => sum + split.canteen, 0);
  const visibleDueCustomers = dueCustomers.filter(
    ({ customer: c }) =>
      c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
  );

  return (
    <AppShell title="Credits">
      <div>
        <p className="text-xl font-bold">Credits</p>
        <p className="text-sm text-[var(--color-text-dim)]">
          {dueCustomers.length} customer{dueCustomers.length === 1 ? "" : "s"} owe{" "}
          {formatMoney(totalDue, currency)} total
        </p>
      </div>

      {dueCustomers.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">GAMING KA BAAKI</p>
            <p className="text-lg font-bold text-[var(--color-warning)] mt-1">{formatMoney(totalGaming, currency)}</p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">CANTEEN KA BAAKI</p>
            <p className="text-lg font-bold text-[var(--color-warning)] mt-1">{formatMoney(totalCanteen, currency)}</p>
          </Card>
        </div>
      )}

      <button
        onClick={() => setShowMonthly(true)}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)]/15 text-[var(--color-primary)] text-sm font-medium py-2.5"
      >
        <CalendarDays size={15} /> Mahine-wise credit (har customer ka)
      </button>

      {dueCustomers.length > 0 && (
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone"
            className="w-full rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"
          />
        </div>
      )}

      {dueCustomers.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-text-faint)] py-16">
          Nobody's on credit right now.
        </p>
      ) : visibleDueCustomers.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-text-faint)] py-16">
          No match for "{search}".
        </p>
      ) : (
        <div className="space-y-2">
          {visibleDueCustomers.map(({ customer: c, creditBalance, pendingTotal, split }) => (
            <Card
              key={c.id}
              onClick={() => setDetailCustomer(c)}
              className="border-[var(--color-warning)]/40"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{customerLabel(c, customers)}</p>
                  <p className="text-xs text-[var(--color-text-dim)]">{c.phone || "No phone"}</p>
                </div>
                <span className="text-sm font-semibold text-[var(--color-warning)]">
                  {formatMoney(creditBalance + pendingTotal, currency)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-center">
                <div className="rounded-lg bg-[var(--color-surface-2)] py-1">
                  <p className="text-[11px] text-[var(--color-text-dim)]">Gaming</p>
                  <p className="text-sm font-semibold">{formatMoney(split.gaming, currency)}</p>
                </div>
                <div className="rounded-lg bg-[var(--color-surface-2)] py-1">
                  <p className="text-[11px] text-[var(--color-text-dim)]">Canteen</p>
                  <p className="text-sm font-semibold">{formatMoney(split.canteen, currency)}</p>
                </div>
              </div>
              {pendingTotal > 0 && (
                <p className="text-xs text-[var(--color-text-faint)] mt-1">
                  {formatMoney(creditBalance, currency)} on credit · {formatMoney(pendingTotal, currency)} not
                  billed yet
                </p>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSettleClick(c);
                }}
                disabled={creditBalance === 0 && pendingTotal === 0}
                className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-success)]/15 text-[var(--color-success)] text-sm font-medium py-2 disabled:opacity-40"
              >
                <Wallet size={14} /> Settle
              </button>
            </Card>
          ))}
        </div>
      )}

      {settleCustomer && (
        <SettleCreditModal customer={settleCustomer} onClose={() => setSettleCustomer(null)} />
      )}
      {showMonthly && (
        <HisaabReport
          initialDate={toDateInputValue(Date.now())}
          initialTab="customer"
          onClose={() => setShowMonthly(false)}
        />
      )}
      {detailCustomer && (
        <CustomerDetailModal customer={detailCustomer} onClose={() => setDetailCustomer(null)} />
      )}
    </AppShell>
  );
}
