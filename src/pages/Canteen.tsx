import { useState, useMemo } from "react";
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
import { useTablesStore, orderedTables } from "../store/useTablesStore";
import { useBillsStore } from "../store/useBillsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, toDateInputValue, formatTime } from "../lib/format";
import { billCollectedByPart } from "../lib/billing";
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

  const ordersForDate = orders
    .filter((o) => toDateInputValue(o.createdAt) === selectedDate)
    .sort((a, b) => b.createdAt - a.createdAt);
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
                      {formatTime(order.createdAt)}
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
  const tables = useTablesStore((s) => s.tables);
  const customers = useCustomersStore((s) => s.customers);
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id ?? "");
  // Who the next item tapped below is for — "" means shared/unspecified
  // (splits with the table charge at billing time, same as before this
  // existed). Only matters when this order's table has more than one
  // person on it; each person then pays for their own food instead of it
  // getting lumped into the group split.
  const [forPerson, setForPerson] = useState("");

  const live = orders.find((o) => o.id === order.id) ?? order;
  const total = live.items.reduce((sum, i) => sum + i.price * i.qty, 0);

  const table = live.tableId ? tables.find((t) => t.id === live.tableId) : null;
  const participants = table
    ? [table.customerId, ...table.extraCustomerIds]
        .map((id) => customers.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c && !c.isWalkIn)
    : [];

  return (
    <Modal title="Edit order" onClose={onClose}>
      <div className="space-y-4">
        {participants.length > 1 && (
          <div>
            <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
              ADDING FOR
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setForPerson("")}
                className={
                  "rounded-full px-3 py-1.5 text-sm font-medium " +
                  (forPerson === ""
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text-dim)]")
                }
              >
                Shared
              </button>
              {participants.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setForPerson(p.name)}
                  className={
                    "rounded-full px-3 py-1.5 text-sm font-medium " +
                    (forPerson === p.name
                      ? "bg-[var(--color-primary)] text-white"
                      : "bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text-dim)]")
                  }
                >
                  {p.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--color-text-faint)] mt-1.5">
              {forPerson
                ? `New items go on ${forPerson}'s own bill, not the group split.`
                : "New items split with the table charge, like before."}
            </p>
          </div>
        )}

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
                    <p className="text-sm">
                      {line.name}
                      {line.personName && (
                        <span className="text-[var(--color-text-faint)]"> · {line.personName}</span>
                      )}
                    </p>
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
          <div className="grid grid-cols-2 gap-2">
            {menuItems
              .filter((i) => i.categoryId === activeCategory)
              .map((item) => {
                const outOfStock = item.stockQty != null && item.stockQty <= 0;
                return (
                  <button
                    key={item.id}
                    onClick={() =>
                      addItem(live.id, {
                        menuItemId: item.id,
                        name: item.name,
                        price: item.price,
                        qty: 1,
                        personName: forPerson || null,
                      })
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
            {menuItems.filter((i) => i.categoryId === activeCategory).length === 0 && (
              <p className="col-span-2 text-sm text-[var(--color-text-faint)] text-center py-4">
                No items in this category yet.
              </p>
            )}
          </div>
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
  const findOrCreateCustomer = useCustomersStore((s) => s.findOrCreateCustomer);
  const createOrder = useOrdersStore((s) => s.createOrder);
  const addItem = useOrdersStore((s) => s.addItem);
  const getOpenOrderForTable = useOrdersStore((s) => s.getOpenOrderForTable);
  const rawTables = useTablesStore((s) => s.tables);
  const tables = useMemo(() => orderedTables(rawTables), [rawTables]);
  const currency = useSettingsStore((s) => s.currencySymbol);

  const [name, setName] = useState("");
  const [tableId, setTableId] = useState("");
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [itemSearch, setItemSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id ?? "");

  // Food for someone already playing goes straight onto their table's tab —
  // billed together when the session stops — instead of the customer-name
  // flow below, which is for standalone/walk-in canteen orders.
  const runningTables = tables.filter((t) => t.status !== "available");

  const setQty = (id: string, qty: number) =>
    setCart((c) => ({ ...c, [id]: Math.max(0, qty) }));

  const total = menuItems.reduce((sum, i) => sum + (cart[i.id] ?? 0) * i.price, 0);
  const setNoteStore = useOrdersStore((s) => s.setNote);

  function handleSave() {
    const items = menuItems.filter((i) => (cart[i.id] ?? 0) > 0);
    if (items.length === 0) return;
    let orderId: string;
    if (tableId) {
      const table = tables.find((t) => t.id === tableId);
      const order = getOpenOrderForTable(tableId) ?? createOrder(tableId, table?.customerId ?? null);
      orderId = order.id;
    } else {
      // A typed name attaches the order (and its bill) to that customer's
      // profile — same rule as starting a table session. Blank = walk-in.
      const customerId = name.trim() ? findOrCreateCustomer({ name: name.trim(), phone: "" }).id : "walk-in";
      orderId = createOrder(null, customerId, null).id;
    }
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

  return (
    <Modal title="New order" onClose={onClose}>
      <div className="space-y-4">
        {runningTables.length > 0 && (
          <div>
            <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1.5">
              TABLE
            </p>
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
            >
              <option value="">Not at a table (standalone order)</option>
              {runningTables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {!tableId && (
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
        )}

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
