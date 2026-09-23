import { useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { CheckoutModal } from "../components/Checkout";
import { BillDetailModal } from "../components/BillDetailModal";
import { AdminPinGate } from "../components/AdminPinGate";
import { CustomerNameInput } from "../components/ui/CustomerNameInput";
import { useOrdersStore } from "../store/useOrdersStore";
import { useMenuStore } from "../store/useMenuStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useTablesStore } from "../store/useTablesStore";
import { useBillsStore } from "../store/useBillsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, toDateInputValue, formatTime } from "../lib/format";
import { billCollectedByPart } from "../lib/billing";
import { findCustomerByName } from "../lib/customerName";
import type { Bill, CanteenOrder } from "../types";
import {
  Scissors,
  Search,
  Plus,
  Minus,
  Check,
  Gamepad2,
  UtensilsCrossed,
  Wallet,
  CalendarDays,
  Trash2,
  UserCheck,
} from "lucide-react";

export function Canteen() {
  const orders = useOrdersStore((s) => s.orders);
  const markServed = useOrdersStore((s) => s.markServed);
  const markBilled = useOrdersStore((s) => s.markBilled);
  const removeOrder = useOrdersStore((s) => s.removeOrder);
  const bills = useBillsStore((s) => s.bills);
  const createOpenBill = useBillsStore((s) => s.createOpenBill);
  const customers = useCustomersStore((s) => s.customers);
  const tables = useTablesStore((s) => s.tables);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "note">("all");
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(Date.now()));
  const [showNew, setShowNew] = useState(false);
  const [editOrder, setEditOrder] = useState<CanteenOrder | null>(null);
  const [checkoutBill, setCheckoutBill] = useState<Bill | null>(null);
  const [detailBill, setDetailBill] = useState<Bill | null>(null);
  const [confirmDeleteOrderId, setConfirmDeleteOrderId] = useState<string | null>(null);

  const isToday = selectedDate === toDateInputValue(Date.now());

  function handleCheckout(order: CanteenOrder) {
    const total = order.items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const orderCustomer = customers.find((c) => c.id === order.customerId);
    const label =
      orderCustomer && !orderCustomer.isWalkIn
        ? orderCustomer.name
        : order.guestName ?? "Canteen order";
    const bill = createOpenBill({
      tableId: null,
      tableName: label,
      orderId: order.id,
      gameId: null,
      gameName: null,
      customerId: order.customerId,
      tableChargeMinutes: 0,
      tableCharge: 0,
      canteenCharge: total,
      canteenItems: order.items.map((i) => ({ name: i.name, price: i.price, qty: i.qty, personName: i.personName ?? null })),
      discount: 0,
    });
    // Mark billed now (not when the checkout modal closes) — otherwise
    // dismissing the modal without paying would hide the order while
    // leaving its bill open with nowhere left to resume it from.
    markBilled(order.id);
    setCheckoutBill(bill);
  }

  // An order billed days after it was placed (an old order finally cleared
  // through checkout) should show up on the day it was actually billed, not
  // the day it was ordered — otherwise it appears on this page under one
  // date while the money it brought in shows on the customer's Khata and
  // every other report under a different date, days apart, looking like it
  // vanished. Once billed, its bill's own createdAt is the one date that
  // actually matches what every other screen already shows for it.
  function orderEffectiveDate(order: CanteenOrder): number {
    if (order.status !== "billed") return order.createdAt;
    return bills.find((b) => b.orderId === order.id)?.createdAt ?? order.createdAt;
  }

  const ordersForDate = orders
    .filter((o) => toDateInputValue(orderEffectiveDate(o)) === selectedDate)
    .sort((a, b) => orderEffectiveDate(b) - orderEffectiveDate(a));
  const activeCount = ordersForDate.filter((o) => o.status !== "billed").length;

  const dateBills = bills.filter(
    (b) => toDateInputValue(b.createdAt) === selectedDate && b.status !== "cancelled"
  );
  const dateCanteenRevenue = dateBills.reduce((sum, b) => sum + billCollectedByPart(b).canteen, 0);

  function orderLabel(order: (typeof orders)[number]) {
    if (order.tableId) {
      const table = tables.find((t) => t.id === order.tableId);
      const customer = customers.find((c) => c.id === order.customerId);
      const person = customer && !customer.isWalkIn ? customer.name : order.guestName ?? "Walk-in";
      return { name: person, context: table ? table.name : "Table", playing: true };
    }
    const customer = customers.find((c) => c.id === order.customerId);
    const name =
      customer && !customer.isWalkIn ? customer.name : order.guestName ?? "Walk-in";
    return { name, context: "Just eating", playing: false };
  }

  const filtered = ordersForDate.filter((o) => {
    if (filter === "note" && !o.note) return false;
    if (!search) return true;
    const { name } = orderLabel(o);
    return (
      o.items.some((i) => i.name.toLowerCase().includes(search.toLowerCase())) ||
      name.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <AppShell title="Canteen">
      <div>
        <p className="text-xl font-bold">Canteen</p>
        <p className="text-sm text-[var(--color-text-dim)]">{activeCount} active orders</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-[var(--color-text-dim)]">ORDERS</p>
          <p className="text-xl font-bold mt-1">{ordersForDate.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--color-text-dim)]">COLLECTED</p>
          <p className="text-xl font-bold text-[var(--color-success)] mt-1">
            {formatMoney(dateCanteenRevenue, currency)}
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

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm"
        >
          <Scissors size={14} /> Menu
        </button>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-dark)] text-white px-3 py-1.5 text-sm font-medium shadow-sm shadow-[var(--color-primary)]/40 transition-transform active:scale-95"
        >
          <Plus size={14} strokeWidth={2.5} /> Order
        </button>
      </div>

      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, item, note..."
          className="w-full rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setFilter("all")}
          className={
            "rounded-full px-4 py-1.5 text-sm font-medium " +
            (filter === "all"
              ? "bg-[var(--color-primary)] text-white"
              : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-dim)]")
          }
        >
          All
        </button>
        <button
          onClick={() => setFilter("note")}
          className={
            "rounded-full px-4 py-1.5 text-sm font-medium " +
            (filter === "note"
              ? "bg-[var(--color-primary)] text-white"
              : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-dim)]")
          }
        >
          With note
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-text-faint)] py-16">
          {isToday ? "No orders yet today. Tap + Order to start." : "No orders on this day."}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => {
            const total = order.items.reduce((sum, i) => sum + i.price * i.qty, 0);
            const label = orderLabel(order);
            const billed = order.status === "billed";
            const orderBill = billed ? bills.find((b) => b.orderId === order.id) : undefined;
            const unpaidBill = orderBill && orderBill.status === "open" ? orderBill : undefined;
            return (
              <Card
                key={order.id}
                onClick={() => {
                  if (unpaidBill) setCheckoutBill(unpaidBill);
                  else if (!billed) setEditOrder(order);
                  else if (orderBill) setDetailBill(orderBill);
                }}
                className={billed && !unpaidBill ? "opacity-60" : ""}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {label.playing ? (
                      <Gamepad2 size={13} className="text-[var(--color-accent)]" />
                    ) : (
                      <UtensilsCrossed size={13} className="text-[var(--color-text-faint)]" />
                    )}
                    <p className="text-sm font-semibold">{label.name}</p>
                    <span className="text-xs text-[var(--color-text-faint)]">· {label.context}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[var(--color-text-faint)]">
                      {formatTime(orderBill?.createdAt ?? order.createdAt)}
                    </span>
                    {order.status === "served" && (
                      <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-[var(--color-success)]/15 text-[var(--color-success)]">
                        Served
                      </span>
                    )}
                    {billed && !unpaidBill && (
                      <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-[var(--color-surface-2)] text-[var(--color-text-dim)]">
                        Billed
                      </span>
                    )}
                    {unpaidBill && (
                      <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
                        Unpaid
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm mt-1">
                  {order.items.map((i) => `${i.name} x${i.qty}`).join(", ")}
                </p>
                {order.note && (
                  <p className="text-xs text-[var(--color-text-dim)] mt-1">{order.note}</p>
                )}
                <div className="flex items-center justify-between mt-3">
                  <p className="text-sm font-semibold">{formatMoney(total, currency)}</p>
                  <div className="flex items-center gap-2">
                    {!billed && order.status === "pending" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          markServed(order.id);
                        }}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] text-sm font-medium px-3 py-1.5"
                      >
                        <Check size={14} /> Served
                      </button>
                    )}
                    {!billed && !order.tableId && order.customerId === "walk-in" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCheckout(order);
                        }}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium px-3 py-1.5"
                      >
                        <Wallet size={14} /> Bill
                      </button>
                    )}
                    {unpaidBill && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCheckoutBill(unpaidBill);
                        }}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium px-3 py-1.5"
                      >
                        <Wallet size={14} /> Settle
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteOrderId(order.id);
                      }}
                      title="Delete this order"
                      className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)] shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {order.tableId && !billed && (
                  <p className="text-xs text-[var(--color-text-faint)] mt-1">
                    Billed together with the table when the session stops
                  </p>
                )}
                {!order.tableId && !billed && order.customerId !== "walk-in" && (
                  <p className="text-xs text-[var(--color-text-faint)] mt-1">
                    Pay from {label.name}'s profile on the Customers page
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {showNew && <NewOrderModal onClose={() => setShowNew(false)} />}
      {editOrder && <OrderEditModal order={editOrder} onClose={() => setEditOrder(null)} />}
      {checkoutBill && <CheckoutModal bill={checkoutBill} onDone={() => setCheckoutBill(null)} />}
      {detailBill && <BillDetailModal bill={detailBill} onClose={() => setDetailBill(null)} />}
      {confirmDeleteOrderId && (
        <AdminPinGate
          title="Delete order"
          onClose={() => setConfirmDeleteOrderId(null)}
          onConfirm={() => removeOrder(confirmDeleteOrderId)}
        />
      )}
    </AppShell>
  );
}

// Live editor for an existing order — every change (add/remove/qty/note)
// writes straight to the store, same as a table's canteen tab. Only reachable
// for orders that aren't billed yet; once billed, the amount is locked.
function OrderEditModal({ order, onClose }: { order: CanteenOrder; onClose: () => void }) {
  const orders = useOrdersStore((s) => s.orders);
  const menuItems = useMenuStore((s) => s.items);
  const categories = useMenuStore((s) => s.categories);
  const addItem = useOrdersStore((s) => s.addItem);
  const changeQty = useOrdersStore((s) => s.changeQty);
  const setNote = useOrdersStore((s) => s.setNote);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id ?? "");
  const [itemSearch, setItemSearch] = useState("");

  const live = orders.find((o) => o.id === order.id) ?? order;
  const total = live.items.reduce((sum, i) => sum + i.price * i.qty, 0);

  return (
    <Modal title="Edit order" onClose={onClose}>
      <div className="space-y-4">
        {live.items.length > 0 && (
          <div>
            <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
              ITEMS
            </p>
            <div className="space-y-2">
              {live.items.map((line) => {
                const menuItem = menuItems.find((i) => i.id === line.menuItemId);
                const atStockLimit = menuItem?.stockQty != null && menuItem.stockQty <= 0;
                return (
                  <div key={line.id} className="flex items-center justify-between">
                    <p className="text-sm">{line.name}</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => changeQty(live.id, line.id, line.qty - 1)}
                        className="h-7 w-7 flex items-center justify-center rounded-full bg-[var(--color-surface-2)]"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-sm w-4 text-center">{line.qty}</span>
                      <button
                        onClick={() => changeQty(live.id, line.id, line.qty + 1)}
                        disabled={atStockLimit}
                        className="h-7 w-7 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] disabled:opacity-30"
                      >
                        <Plus size={12} />
                      </button>
                      <span className="text-sm w-14 text-right">
                        {formatMoney(line.price * line.qty, currency)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            ADD ITEM
          </p>
          <div className="relative mb-3">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
            />
            <input
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder="Search menu..."
              className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] pl-9 pr-3 py-2.5 text-sm outline-none"
            />
          </div>
          {!itemSearch.trim() && (
            <div className="flex gap-2 mb-3">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={
                    "flex-1 rounded-full px-3 py-1.5 text-sm font-medium " +
                    (activeCategory === cat.id
                      ? "bg-[var(--color-primary)] text-white"
                      : "bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text-dim)]")
                  }
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
          {(() => {
            const filteredMenuItems = menuItems.filter((i) =>
              itemSearch.trim()
                ? i.name.toLowerCase().includes(itemSearch.trim().toLowerCase())
                : i.categoryId === activeCategory
            );
            if (filteredMenuItems.length === 0) {
              return (
                <p className="text-sm text-[var(--color-text-faint)] text-center py-4">
                  {itemSearch.trim() ? `No items match "${itemSearch.trim()}"` : "No items in this category yet."}
                </p>
              );
            }
            return (
              <div className="grid grid-cols-2 gap-2">
                {filteredMenuItems.map((item) => {
                  const outOfStock = item.stockQty != null && item.stockQty <= 0;
                  return (
                    <button
                      key={item.id}
                      onClick={() =>
                        addItem(live.id, { menuItemId: item.id, name: item.name, price: item.price, qty: 1 })
                      }
                      disabled={outOfStock}
                      className="text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 disabled:opacity-40"
                    >
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-[var(--color-text-dim)]">
                        {outOfStock ? "Out of stock" : formatMoney(item.price, currency)}
                      </p>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1.5">
            NOTE
          </p>
          <input
            value={live.note}
            onChange={(e) => setNote(live.id, e.target.value)}
            placeholder="Optional note..."
            className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
          <span className="text-sm text-[var(--color-text-dim)]">Total</span>
          <span className="text-lg font-bold">{formatMoney(total, currency)}</span>
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

function NewOrderModal({ onClose }: { onClose: () => void }) {
  const menuItems = useMenuStore((s) => s.items);
  const categories = useMenuStore((s) => s.categories);
  const customers = useCustomersStore((s) => s.customers);
  const findOrCreateCustomer = useCustomersStore((s) => s.findOrCreateCustomer);
  const createOrder = useOrdersStore((s) => s.createOrder);
  const addItem = useOrdersStore((s) => s.addItem);
  const currency = useSettingsStore((s) => s.currencySymbol);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [itemSearch, setItemSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id ?? "");
  // A typed name that matches an already-existing profile needs a beat of
  // confirmation before saving — the suggestion list makes it easy to tap
  // the wrong regular by habit (e.g. whoever's usually at a certain table),
  // silently landing someone else's order on their account. A brand-new
  // name has no such risk, so it skips straight through.
  const [confirmCustomer, setConfirmCustomer] = useState<{ id: string; name: string } | null>(null);

  const setQty = (id: string, qty: number) =>
    setCart((c) => ({ ...c, [id]: Math.max(0, qty) }));

  const total = menuItems.reduce((sum, i) => sum + (cart[i.id] ?? 0) * i.price, 0);
  const setNoteStore = useOrdersStore((s) => s.setNote);

  // Always a standalone order under its own name/walk-in — never attached
  // to a table, so it can never end up billed together with (and read as
  // "merged into") someone else's table session. Food for someone actually
  // playing at a table goes through that table's own "Edit order" instead.
  function saveOrder(customerId: string) {
    const items = menuItems.filter((i) => (cart[i.id] ?? 0) > 0);
    if (items.length === 0) return;
    const orderId = createOrder(null, customerId, null).id;
    items.forEach((item) => {
      addItem(orderId, {
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        qty: cart[item.id],
      });
    });
    if (note) setNoteStore(orderId, note);
    onClose();
  }

  function handleSave() {
    if (menuItems.filter((i) => (cart[i.id] ?? 0) > 0).length === 0) return;
    if (!name.trim()) {
      saveOrder("walk-in");
      return;
    }
    const existing = findCustomerByName(customers, name);
    if (existing) {
      setConfirmCustomer({ id: existing.id, name: existing.name });
      return;
    }
    saveOrder(findOrCreateCustomer({ name: name.trim(), phone: "" }).id);
  }

  if (confirmCustomer) {
    return (
      <Modal title="Confirm customer" onClose={onClose}>
        <div className="space-y-4 py-2 text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-[var(--color-warning)]/15 text-[var(--color-warning)] flex items-center justify-center">
            <UserCheck size={24} />
          </div>
          <p className="text-sm">
            This order will go on <span className="font-semibold">{confirmCustomer.name}</span>'s
            account — is that correct?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setConfirmCustomer(null)}
              className="rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-semibold py-3 text-sm"
            >
              Change name
            </button>
            <button
              onClick={() => saveOrder(confirmCustomer.id)}
              className="rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3 text-sm"
            >
              Yes, that's correct
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New order" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1.5">
            CUSTOMER NAME
          </p>
          <CustomerNameInput
            value={name}
            onChange={setName}
            placeholder="Name — leave blank for walk-in"
          />
        </div>

        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
          />
          <input
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            placeholder="Search menu..."
            className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] pl-9 pr-3 py-2.5 text-sm outline-none"
          />
        </div>

        {!itemSearch.trim() && (
          <div className="flex gap-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={
                  "flex-1 rounded-full px-3 py-1.5 text-sm font-medium " +
                  (activeCategory === cat.id
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text-dim)]")
                }
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {(() => {
          const items = menuItems.filter(
            (i) =>
              (itemSearch.trim()
                ? i.name.toLowerCase().includes(itemSearch.trim().toLowerCase())
                : i.categoryId === activeCategory)
          );
          if (items.length === 0) {
            return (
              <p className="text-sm text-[var(--color-text-faint)] text-center py-4">
                {itemSearch.trim() ? `No items match "${itemSearch.trim()}"` : "No items in this category yet."}
              </p>
            );
          }
          return (
            <div className="space-y-2">
              {items.map((item) => {
                const qtyInCart = cart[item.id] ?? 0;
                const outOfStock = item.stockQty != null && item.stockQty <= 0;
                const atCartLimit = item.stockQty != null && qtyInCart >= item.stockQty;
                return (
                  <div key={item.id} className="flex items-center justify-between">
                    <div>
                      <p className={"text-sm " + (outOfStock ? "text-[var(--color-text-faint)]" : "")}>
                        {item.name}
                      </p>
                      <p className="text-xs text-[var(--color-text-dim)]">
                        {outOfStock ? "Out of stock" : formatMoney(item.price, currency)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setQty(item.id, qtyInCart - 1)}
                        disabled={outOfStock}
                        className="h-7 w-7 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] disabled:opacity-30"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-sm w-4 text-center">{qtyInCart}</span>
                      <button
                        onClick={() => setQty(item.id, qtyInCart + 1)}
                        disabled={atCartLimit}
                        className="h-7 w-7 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] disabled:opacity-30"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1.5">
            NOTE
          </p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note..."
            className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={total === 0}
          className="w-full rounded-xl bg-[var(--color-primary)] disabled:opacity-40 text-white font-semibold py-3"
        >
          Save order · {formatMoney(total, currency)}
        </button>
      </div>
    </Modal>
  );
}
