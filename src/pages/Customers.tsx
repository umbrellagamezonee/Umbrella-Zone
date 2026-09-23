import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { PhoneInput } from "../components/ui/PhoneInput";
import { BillDetailModal } from "../components/BillDetailModal";
import { CheckoutModal } from "../components/Checkout";
import { AdminPinGate } from "../components/AdminPinGate";
import { useCustomersStore } from "../store/useCustomersStore";
import { useBillsStore } from "../store/useBillsStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, formatDateTime } from "../lib/format";
import {
  billCollectedFor,
  creditBalanceFor,
  customerOpenBills,
  customerPendingOrders,
  orderTotal,
  personBillView,
} from "../lib/billing";
import { cleanName, customerLabel, findCustomerByName, normalizeName } from "../lib/customerName";
import { isCreditSettlement } from "../lib/billLabel";
import type { Customer, Bill, CanteenOrder } from "../types";
import { Search, Footprints, Check, ChevronRight, Wallet, Users, Trash2 } from "lucide-react";

// Plain day-to-day directory — look someone up, add a new profile, open
// their history. Credit chasing (who's due, reminders, settling) lives on
// its own Credits tab instead of crowding this list.
export function Customers() {
  const customers = useCustomersStore((s) => s.customers);
  const addCustomer = useCustomersStore((s) => s.addCustomer);
  const removeCustomer = useCustomersStore((s) => s.removeCustomer);
  const bills = useBillsStore((s) => s.bills);
  const orders = useOrdersStore((s) => s.orders);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [blockedDelete, setBlockedDelete] = useState<{ name: string; owed: number } | null>(null);

  // One pass over every bill for the whole list, not one pass per row —
  // this directory can have well over a hundred customers.
  const creditById = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customers) {
      if (c.isWalkIn) continue;
      map.set(c.id, creditBalanceFor(bills, c.id, normalizeName(c.name)));
    }
    return map;
  }, [customers, bills]);

  // Everything a customer could still owe — settled credit, plus bills
  // stuck open, plus orders never billed. Deleting a profile with any of
  // this still outstanding doesn't erase the money, just the only place
  // it was ever visible again — nobody's left to remind or collect from.
  const totalOwedById = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customers) {
      if (c.isWalkIn) continue;
      const credit = creditById.get(c.id) ?? 0;
      const openBills = customerOpenBills(bills, c.id).reduce((s, b) => s + b.amountDue, 0);
      const pending = customerPendingOrders(orders, bills, c.id).reduce((s, o) => s + orderTotal(o), 0);
      map.set(c.id, credit + openBills + pending);
    }
    return map;
  }, [customers, bills, orders, creditById]);

  function handleDeleteClick(c: Customer) {
    const owed = totalOwedById.get(c.id) ?? 0;
    if (owed > 0.5) {
      setBlockedDelete({ name: c.name, owed });
      return;
    }
    setConfirmDeleteId(c.id);
  }

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  );

  function handleAdd() {
    if (!name.trim()) return;
    // Don't stack a second profile on a name that's already here — open the
    // existing one instead.
    const existing = findCustomerByName(customers, name);
    if (existing) {
      setDetailCustomer(existing);
    } else {
      addCustomer({ name: name.trim(), phone, email });
    }
    setName("");
    setPhone("");
    setEmail("");
    setShowAdd(false);
  }

  return (
    <AppShell title="Customers">
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, email"
          className="w-full rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"
        />
      </div>

      <button
        onClick={() => setShowAdd(true)}
        className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
      >
        Add customer
      </button>

      <div className="space-y-2">
        {filtered.map((c) => (
          <Card
            key={c.id}
            onClick={c.isWalkIn ? undefined : () => setDetailCustomer(c)}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center">
                {c.isWalkIn ? (
                  <Footprints size={18} className="text-[var(--color-accent)]" />
                ) : (
                  <span className="text-sm font-semibold">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <p className="text-sm font-medium">{customerLabel(c, customers)}</p>
                <p className="text-xs text-[var(--color-text-dim)]">
                  {c.phone || (c.isWalkIn ? "System" : "No phone")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {(totalOwedById.get(c.id) ?? 0) > 0 ? (
                <span className="text-xs font-semibold text-[var(--color-warning)]">
                  {formatMoney(totalOwedById.get(c.id) ?? 0, currency)} due
                </span>
              ) : (
                !c.isWalkIn && <Check size={16} className="text-[var(--color-text-faint)]" />
              )}
              {!c.isWalkIn && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick(c);
                  }}
                  title="Delete this customer"
                  className="h-7 w-7 flex items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)] shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              )}
              {!c.isWalkIn && <ChevronRight size={16} className="text-[var(--color-text-faint)]" />}
            </div>
          </Card>
        ))}
      </div>

      {detailCustomer && (
        <CustomerDetailModal customer={detailCustomer} onClose={() => setDetailCustomer(null)} />
      )}

      {blockedDelete && (
        <Modal title="Can't delete yet" onClose={() => setBlockedDelete(null)}>
          <div className="space-y-4">
            <p className="text-sm">
              <strong>{blockedDelete.name}</strong> still owes{" "}
              <strong>{formatMoney(blockedDelete.owed, currency)}</strong>. Settle this first —
              deleting the profile now would make that amount impossible to track or collect.
            </p>
            <button
              onClick={() => setBlockedDelete(null)}
              className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
            >
              Okay
            </button>
          </div>
        </Modal>
      )}

      {confirmDeleteId && (
        <AdminPinGate
          title="Delete customer"
          onClose={() => setConfirmDeleteId(null)}
          onConfirm={() => removeCustomer(confirmDeleteId)}
        />
      )}

      {showAdd && (
        <Modal title="Add customer" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
            />
            <PhoneInput value={phone} onChange={setPhone} />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
            />
            <button
              onClick={handleAdd}
              className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
            >
              Save
            </button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

interface LedgerEntry {
  id: string;
  date: number;
  particulars: string;
  debit: number; // charged onto their running balance
  credit: number; // paid off their running balance
  paidNow: boolean; // settled in cash/account on the spot — never touched the balance at all
  balanceAfter: number;
  bill: Bill | null; // set for anything tappable through to the full receipt
  order: CanteenOrder | null; // set only for a still-pending (unbilled) order
}

// What this line is actually for. A table session (has a real tableId)
// shows the table's name; anything canteen-only shows what was actually
// ordered instead — a standalone order's bill.tableName is set to the
// customer's own name (see handleBillOrder/Credits' handleSettleClick), not
// a useful description, so falling back to it here would just repeat their
// name for every line.
function describeItems(items: { name: string; qty: number }[]): string {
  if (items.length === 0) return "Canteen order";
  return items.map((i) => (i.qty > 1 ? `${i.name} x${i.qty}` : i.name)).join(", ");
}

// One running-balance account for this customer — every bill that's ever
// touched their credit, plus whatever's served but not yet billed, in
// time order. Processed oldest-first so the balance accumulates correctly
// (a credit settlement pays down exactly what came before it), then handed
// back newest-first to display, each row keeping the balance as it stood
// right after that entry.
function buildLedger(customerBills: Bill[], pendingOrders: CanteenOrder[], nameKey: string): LedgerEntry[] {
  type RawEvent =
    | { date: number; kind: "bill"; bill: Bill }
    | { date: number; kind: "pending"; order: CanteenOrder };
  const rawEvents: RawEvent[] = [
    ...customerBills.map((b): RawEvent => ({ date: b.createdAt, kind: "bill", bill: b })),
    ...pendingOrders.map((o): RawEvent => ({ date: o.createdAt, kind: "pending", order: o })),
  ].sort((a, b) => a.date - b.date);

  let balance = 0;
  const entries = rawEvents.map((ev): LedgerEntry => {
    if (ev.kind === "pending") {
      const amount = orderTotal(ev.order);
      balance += amount;
      return {
        id: `pending-${ev.order.id}`,
        date: ev.date,
        particulars: describeItems(ev.order.items),
        debit: amount,
        credit: 0,
        paidNow: false,
        balanceAfter: balance,
        bill: null,
        order: ev.order,
      };
    }
    const b = ev.bill;
    if (isCreditSettlement(b)) {
      const amount = b.amountPaid + b.discount;
      balance -= amount;
      return {
        id: b.id,
        date: b.createdAt,
        particulars: "Credit settled",
        debit: 0,
        credit: amount,
        paidNow: false,
        balanceAfter: balance,
        bill: b,
        order: null,
      };
    }
    const view = personBillView(b, nameKey);
    if (view.onCredit > 0) balance += view.onCredit;
    return {
      id: b.id,
      date: b.createdAt,
      particulars: b.tableId ? (b.tableName ?? "Table") : describeItems(b.canteenItems),
      debit: view.onCredit,
      credit: 0,
      paidNow: view.onCredit === 0,
      balanceAfter: balance,
      bill: b,
      order: null,
    };
  });

  return entries.reverse();
}

// Every bill/order that's touched this customer, in ledger form — date,
// particulars, amount, running balance — instead of separate "pending"
// cards and day-grouped history cards.
export function CustomerDetailModal({ customer: initialCustomer, onClose }: { customer: Customer; onClose: () => void }) {
  const bills = useBillsStore((s) => s.bills);
  // Deleted bills too — a credit balance doesn't get reversed when the bill
  // that created it is trashed, so leaving those out would hide exactly the
  // history someone's most likely trying to track down.
  const deletedBills = useBillsStore((s) => s.deletedBills);
  const reassignCustomer = useBillsStore((s) => s.reassignCustomer);
  const createOpenBill = useBillsStore((s) => s.createOpenBill);
  const settlePayment = useBillsStore((s) => s.settlePayment);
  const orders = useOrdersStore((s) => s.orders);
  const markOrderBilled = useOrdersStore((s) => s.markBilled);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const allCustomers = useCustomersStore((s) => s.customers);
  const mergeCustomer = useCustomersStore((s) => s.mergeCustomer);
  const updateCustomer = useCustomersStore((s) => s.updateCustomer);
  const [detailBill, setDetailBill] = useState<Bill | null>(null);
  const [checkoutBill, setCheckoutBill] = useState<Bill | null>(null);
  const [showSettle, setShowSettle] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Customer | null>(null);
  // Read live off the store — settling a payment from right here should
  // update the balance on screen immediately, not just after closing and
  // reopening this modal.
  const customer =
    useCustomersStore((s) => s.customers.find((c) => c.id === initialCustomer.id)) ?? initialCustomer;

  // Buffered locally and only committed on blur, unlike phone below — every
  // past bill that named this person gets rewritten on a real name change
  // (see reassignCustomer below), which isn't something to redo on every
  // keystroke.
  const [nameInput, setNameInput] = useState(customer.name);

  function commitName() {
    const cleaned = cleanName(nameInput);
    if (!cleaned || cleaned === customer.name) {
      setNameInput(customer.name);
      return;
    }
    reassignCustomer(customer.id, customer.name, customer.id, cleaned);
    updateCustomer(customer.id, { name: cleaned });
  }

  const nameKey = normalizeName(customer.name);
  // Only bills this person actually owes/paid for — not every match they
  // happened to play in. A split "loser pays" bill's shares name the real
  // payers; anyone playing but not in shares (they won, or paid free) never
  // owed anything and shouldn't see it on their own profile. For a
  // single-payer bill customerId is always the real payer (see
  // TableDetailModal's handleStopAndBill), so that alone is enough.
  const matchesCustomer = (b: Bill) =>
    b.shares
      ? b.shares.some((s) => normalizeName(s.payerName) === nameKey)
      : b.customerId === customer.id;

  // Other real customers this one could be merged into — same-name profiles
  // first, since those are the accidental duplicates worth cleaning up.
  const mergeCandidates = allCustomers
    .filter((c) => !c.isWalkIn && c.id !== customer.id)
    .sort(
      (a, b) =>
        (normalizeName(b.name) === nameKey ? 1 : 0) - (normalizeName(a.name) === nameKey ? 1 : 0) ||
        a.name.localeCompare(b.name)
    );

  function confirmMerge(target: Customer) {
    reassignCustomer(customer.id, customer.name, target.id, target.name);
    mergeCustomer(customer.id, target.id);
    setMergeTarget(null);
    onClose();
  }

  // Canteen food served to this customer but not yet paid for — canteen
  // staff mark an order "served" and payment happens from here instead of
  // billing it on the spot at the counter.
  const pendingOrders = customerPendingOrders(orders, bills, customer.id);
  const pendingTotal = pendingOrders.reduce((sum, o) => sum + orderTotal(o), 0);
  // Bills that already exist but got left "open" — checkout started, never
  // finished (screen closed, app switched away). Real money owed, just not
  // in creditBalance yet — folded in here so TOTAL OWED always matches what
  // the ledger below reconstructs, instead of looking wrong until the 24h
  // auto-sweep eventually catches it.
  const openBills = customerOpenBills(bills, customer.id);
  const openBillsTotal = openBills.reduce((sum, b) => sum + b.amountDue, 0);
  const customerCredit = creditBalanceFor(bills, customer.id, nameKey);
  const totalOwed = customerCredit + pendingTotal + openBillsTotal;

  function handleBillOrder(order: (typeof pendingOrders)[number]) {
    const total = orderTotal(order);
    const bill = createOpenBill({
      tableId: null,
      tableName: customer.name,
      orderId: order.id,
      gameId: null,
      gameName: null,
      customerId: customer.id,
      tableChargeMinutes: 0,
      tableCharge: 0,
      canteenCharge: total,
      canteenItems: order.items.map((i) => ({
        name: i.name,
        price: i.price,
        qty: i.qty,
        personName: i.personName ?? null,
      })),
      discount: 0,
    });
    markOrderBilled(order.id);
    setCheckoutBill(bill);
  }

  // Settle needs a real credit balance to pay off — a customer whose total
  // owed is entirely unbilled pending orders (or stuck-open bills) has
  // creditBalance 0, so bill every pending order and settle every stuck-open
  // bill onto their credit first (same as Credits' own handleSettleClick and
  // the 24h auto-credit sweep), then open Settle for the resulting real
  // balance. Otherwise "Settle payment" would either stay hidden or pay off
  // only part of what's owed, leaving the rest looking stuck as still-pending
  // even right after a full settlement.
  function handleSettleClick() {
    for (const order of pendingOrders) {
      const total = orderTotal(order);
      if (total <= 0) continue;
      const bill = createOpenBill({
        tableId: null,
        tableName: customer.name,
        orderId: order.id,
        gameId: null,
        gameName: null,
        customerId: customer.id,
        tableChargeMinutes: 0,
        tableCharge: 0,
        canteenCharge: total,
        canteenItems: order.items.map((i) => ({
          name: i.name,
          price: i.price,
          qty: i.qty,
          personName: i.personName ?? null,
        })),
        discount: 0,
      });
      markOrderBilled(order.id);
      settlePayment(bill.id, { amountCash: 0, amountUpi: 0 });
    }
    for (const bill of openBills) {
      settlePayment(bill.id, { amountCash: 0, amountUpi: 0 });
    }
    setShowSettle(true);
  }

  const customerBills = [...bills, ...deletedBills]
    .filter(matchesCustomer)
    .sort((a, b) => b.createdAt - a.createdAt);
  const deletedCount = customerBills.filter((b) => b.deletedAt).length;

  // A "match" is one table session that actually counted — canteen-only bills,
  // credit settlements, cancellations and trashed sessions don't.
  const isMatch = (b: Bill) => !!b.tableId && !b.deletedAt && b.status !== "cancelled";
  const totalMatches = customerBills.filter(isMatch).length;
  const totalSpent = customerBills.reduce((sum, b) => sum + billCollectedFor(b, nameKey), 0);

  // A running-balance ledger — every bill that's ever touched this
  // customer's credit, plus whatever's served but not yet billed, in one
  // time-ordered account instead of separate "pending" cards and
  // day-grouped history. Built oldest-first so the balance accumulates
  // correctly, then shown newest-first (each row keeps the balance as it
  // stood right after that entry).
  const ledgerEntries = buildLedger(customerBills, pendingOrders, nameKey);

  return (
    <Modal title={customerLabel(customer, allCustomers)} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--color-text-dim)] shrink-0">Name</span>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={commitName}
            className="flex-1 min-w-0 text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">MATCHES</p>
            <p className="text-xl font-bold mt-1">{totalMatches}</p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">TOTAL SPENT</p>
            <p className="text-xl font-bold text-[var(--color-success)] mt-1">
              {formatMoney(totalSpent, currency)}
            </p>
          </Card>
        </div>

        {totalOwed > 0 && (
          <Card className="border-[var(--color-warning)]/40">
            <p className="text-xs text-[var(--color-text-dim)]">TOTAL OWED</p>
            <p className="text-lg font-bold text-[var(--color-warning)] mt-1">
              {formatMoney(totalOwed, currency)}
            </p>
            {deletedCount > 0 && (
              <p className="text-xs text-[var(--color-text-faint)] mt-1">
                {deletedCount} bill{deletedCount > 1 ? "s" : ""} below {deletedCount > 1 ? "were" : "was"}{" "}
                deleted — check them for what added to this. Older credit changes with no bill left
                at all (permanently deleted, or from before this device tracked history) can't be
                traced back further than that.
              </p>
            )}
            <button
              onClick={handleSettleClick}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-success)]/15 text-[var(--color-success)] text-sm font-medium py-2.5"
            >
              <Wallet size={14} /> Settle payment
            </button>
          </Card>
        )}

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            LEDGER
          </p>
          {ledgerEntries.length === 0 ? (
            <p className="text-sm text-[var(--color-text-faint)] text-center py-6">
              No sessions yet.
            </p>
          ) : (
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="grid grid-cols-[1fr_72px_80px] gap-2 px-3 py-2 bg-[var(--color-surface-2)]">
                <span className="text-[10px] font-semibold text-[var(--color-text-dim)]">
                  PARTICULARS
                </span>
                <span className="text-[10px] font-semibold text-[var(--color-text-dim)] text-right whitespace-nowrap">
                  AMOUNT
                </span>
                <span className="text-[10px] font-semibold text-[var(--color-text-dim)] text-right whitespace-nowrap">
                  BALANCE
                </span>
              </div>
              {ledgerEntries.map((entry) => {
                const dimmed = entry.bill && (entry.bill.deletedAt || entry.bill.status === "cancelled");
                return (
                  <div
                    key={entry.id}
                    onClick={entry.bill ? () => setDetailBill(entry.bill!) : undefined}
                    className={
                      "grid grid-cols-[1fr_72px_80px] gap-2 px-3 py-2.5 border-t border-[var(--color-border)] items-center " +
                      (entry.bill ? "cursor-pointer active:bg-[var(--color-surface-2)] " : "") +
                      (dimmed ? "opacity-50" : "")
                    }
                  >
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {entry.particulars}
                        {entry.bill?.deletedAt && (
                          <span className="text-[var(--color-danger)] font-normal"> · Deleted</span>
                        )}
                        {entry.bill?.status === "cancelled" && (
                          <span className="text-[var(--color-text-faint)] font-normal"> · Cancelled</span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--color-text-faint)]">{formatDateTime(entry.date)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {entry.debit > 0 ? (
                        <span className="text-sm text-[var(--color-warning)]">
                          +{formatMoney(entry.debit, currency)}
                        </span>
                      ) : entry.credit > 0 ? (
                        <span className="text-sm text-[var(--color-success)]">
                          −{formatMoney(entry.credit, currency)}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-faint)]">Paid</span>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-right shrink-0">
                      {formatMoney(entry.balanceAfter, currency)}
                    </span>
                    {entry.order && (
                      <div className="col-span-3 mt-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleBillOrder(entry.order!);
                          }}
                          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)]/15 text-[var(--color-primary)] text-xs font-medium py-1.5"
                        >
                          <Wallet size={12} /> Bill this order
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {mergeCandidates.length > 0 && (
          <details className="rounded-xl bg-[var(--color-surface-2)] overflow-hidden">
            <summary className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none list-none text-xs font-semibold tracking-wide text-[var(--color-text-dim)]">
              <Users size={13} /> SAME PERSON AS SOMEONE ELSE?
            </summary>
            <div className="px-3 pb-3 space-y-2">
              <p className="text-xs text-[var(--color-text-faint)]">
                Pick who this is really the same as — every match, bill and credit balance moves
                onto them and this duplicate is removed. Can't be undone.
              </p>
              {mergeCandidates.slice(0, 8).map((c) => {
                const due = creditBalanceFor(bills, c.id, normalizeName(c.name));
                return (
                  <button
                    key={c.id}
                    onClick={() => setMergeTarget(c)}
                    className="w-full flex items-center justify-between gap-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2.5 text-left"
                  >
                    <span className="text-sm">{customerLabel(c, allCustomers)}</span>
                    {due > 0 && (
                      <span className="text-xs text-[var(--color-warning)] shrink-0">
                        {formatMoney(due, currency)} due
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </details>
        )}
      </div>

      {detailBill && <BillDetailModal bill={detailBill} onClose={() => setDetailBill(null)} />}
      {checkoutBill && <CheckoutModal bill={checkoutBill} onDone={() => setCheckoutBill(null)} />}
      {showSettle && <SettleCreditModal customer={customer} onClose={() => setShowSettle(false)} />}
      {mergeTarget && (
        <Modal title="Merge customers" onClose={() => setMergeTarget(null)}>
          <div className="space-y-4">
            <p className="text-sm">
              Move everything from <span className="font-semibold">{customerLabel(customer, allCustomers)}</span>{" "}
              into <span className="font-semibold">{customerLabel(mergeTarget, allCustomers)}</span>?
            </p>
            <p className="text-xs text-[var(--color-text-faint)]">
              All their sessions and bills get re-tagged, and{" "}
              {formatMoney(customerCredit, currency)} credit moves onto{" "}
              {customerLabel(mergeTarget, allCustomers)}. This customer is then deleted. This can't be
              undone.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMergeTarget(null)}
                className="rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-semibold py-3 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmMerge(mergeTarget)}
                className="rounded-xl bg-[var(--color-danger)] text-white font-semibold py-3 text-sm"
              >
                Merge
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

// Collects a credit payment (cash/UPI), with an optional discount to write
// off part of what's owed — recorded as its own settled bill so it counts
// toward the day's collection, not just a number quietly shrinking.
export function SettleCreditModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const currency = useSettingsStore((s) => s.currencySymbol);
  const recordCreditSettlement = useBillsStore((s) => s.recordCreditSettlement);
  const bills = useBillsStore((s) => s.bills);
  const customerDue = creditBalanceFor(bills, customer.id, normalizeName(customer.name));

  const [discountInput, setDiscountInput] = useState("0");
  const [cashInput, setCashInput] = useState(customerDue.toFixed(2));
  const [accountInput, setAccountInput] = useState("0");
  const [settled, setSettled] = useState<{ amountCash: number; amountUpi: number; discount: number } | null>(
    null
  );

  const discount = Math.min(Math.max(0, Number(discountInput) || 0), customerDue);
  const payableMax = Math.max(0, customerDue - discount);
  const cash = Math.min(Math.max(0, Number(cashInput) || 0), payableMax);
  const account = Math.min(Math.max(0, Number(accountInput) || 0), Math.max(0, payableMax - cash));
  const amountPaid = cash + account;
  const remaining = Math.max(0, customerDue - amountPaid - discount);
  const canSettle = amountPaid > 0 || discount > 0;

  function handleSettle() {
    if (!canSettle) return;
    recordCreditSettlement({
      customerId: customer.id,
      customerName: customer.name,
      amountCash: cash,
      amountUpi: account,
      discount,
    });
    setSettled({ amountCash: cash, amountUpi: account, discount });
  }

  if (settled) {
    return (
      <Modal title={customer.name} onClose={onClose}>
        <div className="space-y-4 py-4 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] flex items-center justify-center">
            <Check size={32} />
          </div>
          <div>
            {settled.amountCash + settled.amountUpi > 0 && (
              <p className="text-2xl font-bold">
                {formatMoney(settled.amountCash + settled.amountUpi, currency)}
              </p>
            )}
            {settled.amountCash > 0 && settled.amountUpi > 0 ? (
              <p className="text-sm text-[var(--color-text-dim)] mt-1">
                {formatMoney(settled.amountCash, currency)} cash + {formatMoney(settled.amountUpi, currency)} account
              </p>
            ) : settled.amountUpi > 0 ? (
              <p className="text-sm text-[var(--color-text-dim)] mt-1">Received via Account</p>
            ) : settled.amountCash > 0 ? (
              <p className="text-sm text-[var(--color-text-dim)] mt-1">Received via Cash</p>
            ) : null}
            {settled.discount > 0 && (
              <p className="text-sm text-[var(--color-warning)] mt-2">
                {formatMoney(settled.discount, currency)} written off
              </p>
            )}
            <p className="text-sm text-[var(--color-text-dim)] mt-2">
              {remaining > 0
                ? `${formatMoney(remaining, currency)} still due`
                : "Credit fully cleared"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Settle · ${customer.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Card>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--color-text-dim)]">Total due</span>
            <span className="font-semibold">{formatMoney(customerDue, currency)}</span>
          </div>
        </Card>

        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-dim)]">Discount</span>
          <input
            type="number"
            min={0}
            max={customerDue}
            value={discountInput}
            onChange={(e) => {
              const raw = e.target.value;
              setDiscountInput(raw);
              // Keep "Receiving now" visually honest — raising the discount
              // shouldn't leave a stale amount sitting there that adds up to
              // more than what's actually owed.
              const newDiscount = Math.min(Math.max(0, Number(raw) || 0), customerDue);
              const maxAmount = customerDue - newDiscount;
              setCashInput((prev) => ((Number(prev) || 0) > maxAmount ? maxAmount.toFixed(2) : prev));
            }}
            className="w-24 text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-dim)]">Cash</span>
          <input
            type="number"
            min={0}
            max={payableMax}
            value={cashInput}
            onChange={(e) => setCashInput(e.target.value)}
            className="w-24 text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-dim)]">Account (UPI)</span>
          <input
            type="number"
            min={0}
            max={Math.max(0, payableMax - cash)}
            value={accountInput}
            onChange={(e) => setAccountInput(e.target.value)}
            className="w-24 text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
          />
        </div>

        <p className="text-xs text-[var(--color-text-faint)] -mt-2">
          {remaining > 0
            ? `${formatMoney(remaining, currency)} will still be due after this.`
            : "This clears their credit completely."}
        </p>

        <button
          onClick={handleSettle}
          disabled={!canSettle}
          className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3 disabled:opacity-40"
        >
          Settle
        </button>
      </div>
    </Modal>
  );
}
