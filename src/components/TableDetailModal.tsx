import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Card } from "./ui/Card";
import { SplitBillModal } from "./SplitBillModal";
import { SplitCheckout } from "./SplitCheckout";
import { Checkout } from "./Checkout";
import { useTablesStore } from "../store/useTablesStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useMenuStore } from "../store/useMenuStore";
import { useGamesStore } from "../store/useGamesStore";
import { useBillsStore } from "../store/useBillsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatDuration, formatMoney, elapsedMinutesExact, costForElapsed } from "../lib/format";
import { tableElapsedMs, tableRemainingMs, activeRate } from "../lib/tableTiming";
import type { BillingTable, Bill } from "../types";
import { Plus, Minus, Users, UserPlus, Search, Frown } from "lucide-react";

export function TableDetailModal({
  table,
  onClose,
  now,
}: {
  table: BillingTable;
  onClose: () => void;
  now: number;
}) {
  const currency = useSettingsStore((s) => s.currencySymbol);
  const customers = useCustomersStore((s) => s.customers);
  const findOrCreateCustomer = useCustomersStore((s) => s.findOrCreateCustomer);
  const games = useGamesStore((s) => s.games);
  const stopSession = useTablesStore((s) => s.stopSession);
  const addParticipant = useTablesStore((s) => s.addParticipant);
  const updateTable = useTablesStore((s) => s.updateTable);
  const menuItems = useMenuStore((s) => s.items);
  const orders = useOrdersStore((s) => s.orders);
  const createOrder = useOrdersStore((s) => s.createOrder);
  const addItem = useOrdersStore((s) => s.addItem);
  const changeQty = useOrdersStore((s) => s.changeQty);
  const createOpenBill = useBillsStore((s) => s.createOpenBill);
  const deleteBill = useBillsStore((s) => s.deleteBill);
  const markBilled = useOrdersStore((s) => s.markBilled);
  const unmarkBilled = useOrdersStore((s) => s.unmarkBilled);

  const [discount, setDiscount] = useState(0);
  const [itemSearch, setItemSearch] = useState("");
  const [checkoutBill, setCheckoutBill] = useState<Bill | null>(null);
  const [showSplit, setShowSplit] = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [showLoserPicker, setShowLoserPicker] = useState(false);
  // Snapshot taken right before a non-split Stop & Bill, so cancelling the
  // checkout before paying can put the session back exactly as it was
  // instead of leaving it stopped with nowhere to undo from.
  const [undo, setUndo] = useState<{
    tableSnapshot: Partial<BillingTable>;
    orderId: string | null;
    billId: string;
  } | null>(null);

  const order = orders.find((o) => o.tableId === table.id && o.status !== "billed");
  const canteenTotal = order?.items.reduce((sum, i) => sum + i.price * i.qty, 0) ?? 0;

  const rate = activeRate(table);
  const game = games.find((g) => g.id === table.activeGameId);
  const elapsed = tableElapsedMs(table, now);
  const minutesBilled = elapsedMinutesExact(elapsed);
  const tableCharge = table.status === "available" ? 0 : costForElapsed(elapsed, rate);
  // Clamp against the raw input in case items/time changed after the discount was typed
  // (e.g. a canteen item removed) — the bill total must never go negative.
  const effectiveDiscount = Math.min(discount, tableCharge + canteenTotal);
  const total = tableCharge + canteenTotal - effectiveDiscount;
  const remaining = tableRemainingMs(table, now);
  const overtime = remaining != null && remaining < 0;

  function ensureOrder() {
    if (order) return order;
    return createOrder(table.id, table.customerId);
  }

  function handleAddMenuItem(item: (typeof menuItems)[number]) {
    const o = ensureOrder();
    addItem(o.id, { menuItemId: item.id, name: item.name, price: item.price, qty: 1 });
  }

  function handleStopAndBill(
    shares?: { label: string; payerName: string; amount: number }[],
    loser?: { customerId: string; name: string }
  ) {
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
      customerId: loser?.customerId ?? table.customerId,
      tableChargeMinutes: minutesBilled,
      tableCharge,
      canteenCharge: canteenTotal,
      canteenItems: order?.items.map((i) => ({ name: i.name, price: i.price, qty: i.qty })) ?? [],
      discount: shares ? 0 : effectiveDiscount,
      shares,
      matchParticipants: participantNames.length > 1 ? participantNames : null,
      matchLoser: loser?.name ?? null,
    });
    if (order) markBilled(order.id);
    // Split bills can end up partially paid, so there's nothing safe to undo
    // once that flow starts — only offer it for the regular single-payer path.
    if (!shares) {
      setUndo({ tableSnapshot, orderId: order?.id ?? null, billId: bill.id });
    }
    setCheckoutBill(bill);
  }

  function cancelCheckout() {
    if (undo) {
      updateTable(table.id, undo.tableSnapshot);
      if (undo.orderId) unmarkBilled(undo.orderId);
      deleteBill(undo.billId);
      setUndo(null);
    }
    setCheckoutBill(null);
  }

  const customer = customers.find((c) => c.id === table.customerId);
  const extraNames = table.extraCustomerIds
    .map((id) => customers.find((c) => c.id === id)?.name)
    .filter((n): n is string => !!n);
  const participantNames = [customer ? customer.name : "Walk-in", ...extraNames];
  const peopleLabel = participantNames.join(", ");
  // Same list, but paired with customer ids — needed to bill "Loser pays" to
  // the right person rather than just the primary contact.
  const participants: { id: string; name: string }[] = [
    ...(table.customerId ? [{ id: table.customerId, name: customer?.name ?? "Walk-in" }] : []),
    ...table.extraCustomerIds
      .map((id) => {
        const c = customers.find((x) => x.id === id);
        return c ? { id, name: c.name } : null;
      })
      .filter((p): p is { id: string; name: string } => !!p),
  ];

  return (
    <Modal title={table.name} onClose={checkoutBill && undo ? cancelCheckout : onClose}>
      {!checkoutBill ? (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs text-[var(--color-text-dim)]">
                    {peopleLabel}
                    {game && ` · ${game.name}`}
                  </p>
                  <button
                    onClick={() => setShowAddPerson(true)}
                    className="h-5 w-5 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-primary)] shrink-0"
                    title="Add another person to this table"
                  >
                    <UserPlus size={11} />
                  </button>
                </div>
                <p className="text-2xl font-bold font-mono">{formatDuration(elapsed)}</p>
                {remaining != null && (
                  <p
                    className={
                      "text-xs font-medium mt-0.5 " +
                      (overtime ? "text-[var(--color-danger)]" : "text-[var(--color-text-faint)]")
                    }
                  >
                    {overtime
                      ? `${formatDuration(-remaining)} over the ${table.defaultSessionMinutes}m session`
                      : `${formatDuration(remaining)} left of ${table.defaultSessionMinutes}m session`}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-[var(--color-text-dim)]">
                  Table charge · {formatMoney(rate, currency)}/hr
                </p>
                <p className="text-lg font-bold">{formatMoney(tableCharge, currency)}</p>
              </div>
            </div>
          </Card>

          <details className="group">
            <summary className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] cursor-pointer select-none py-1">
              ADD FROM MENU
            </summary>
            <div className="mt-2">
              <div className="relative mb-2">
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
              <div className="grid grid-cols-2 gap-2">
                {menuItems
                  .filter((item) =>
                    !itemSearch.trim() ||
                    item.name.toLowerCase().includes(itemSearch.trim().toLowerCase())
                  )
                  .map((item) => {
                    const outOfStock = item.stockQty != null && item.stockQty <= 0;
                    const qtyInOrder = order?.items.find((i) => i.menuItemId === item.id)?.qty ?? 0;
                    const added = qtyInOrder > 0;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleAddMenuItem(item)}
                        disabled={outOfStock}
                        className={
                          "text-left rounded-xl border px-3 py-2 disabled:opacity-40 " +
                          (added
                            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15"
                            : "border-[var(--color-border)] bg-[var(--color-surface-2)]")
                        }
                      >
                        <p className={"text-sm font-medium " + (added ? "text-[var(--color-primary)]" : "")}>
                          {item.name}
                        </p>
                        <p
                          className={
                            "text-xs " +
                            (added ? "text-[var(--color-primary)]" : "text-[var(--color-text-dim)]")
                          }
                        >
                          {outOfStock
                            ? "Out of stock"
                            : added
                            ? `Added · x${qtyInOrder}`
                            : formatMoney(item.price, currency)}
                        </p>
                      </button>
                    );
                  })}
              </div>
              {itemSearch.trim() &&
                !menuItems.some((i) => i.name.toLowerCase().includes(itemSearch.trim().toLowerCase())) && (
                  <p className="text-sm text-[var(--color-text-faint)] text-center py-2">
                    No items match "{itemSearch.trim()}"
                  </p>
                )}
            </div>
          </details>

          {order && order.items.length > 0 && (
            <div>
              <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
                CANTEEN TAB
              </p>
              <div className="space-y-2">
                {order.items.map((line) => {
                  const menuItem = menuItems.find((i) => i.id === line.menuItemId);
                  const atStockLimit = menuItem?.stockQty != null && menuItem.stockQty <= 0;
                  return (
                    <div key={line.id} className="flex items-center justify-between">
                      <p className="text-sm">{line.name}</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => changeQty(order.id, line.id, line.qty - 1)}
                          className="h-7 w-7 flex items-center justify-center rounded-full bg-[var(--color-surface-2)]"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="text-sm w-4 text-center">{line.qty}</span>
                        <button
                          onClick={() => changeQty(order.id, line.id, line.qty + 1)}
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

          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text-dim)]">Discount</span>
            <input
              type="number"
              min={0}
              max={tableCharge + canteenTotal}
              value={discount}
              onChange={(e) =>
                setDiscount(Math.min(Math.max(0, Number(e.target.value) || 0), tableCharge + canteenTotal))
              }
              className="w-24 text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
            />
          </div>

          <button
            onClick={() => handleStopAndBill()}
            className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
          >
            Stop & Bill · {formatMoney(total, currency)}
          </button>
          <button
            onClick={() => setShowSplit(true)}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm font-medium py-2.5"
          >
            <Users size={15} /> Split between multiple people
          </button>
          {participants.length > 1 && (
            <button
              onClick={() => setShowLoserPicker(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm font-medium py-2.5"
            >
              <Frown size={15} /> Loser pays
            </button>
          )}
        </div>
      ) : checkoutBill.shares ? (
        <SplitCheckout bill={checkoutBill} onDone={onClose} />
      ) : (
        <Checkout
          bill={checkoutBill}
          onDone={onClose}
          onCancel={undo ? cancelCheckout : undefined}
          onSettled={() => setUndo(null)}
        />
      )}

      {showSplit && (
        <SplitBillModal
          tableCharge={tableCharge}
          canteenItems={order?.items ?? []}
          participantNames={participantNames}
          onClose={() => setShowSplit(false)}
          onConfirm={(shares) => {
            setShowSplit(false);
            handleStopAndBill(shares);
          }}
        />
      )}

      {showAddPerson && (
        <AddPersonModal
          onClose={() => setShowAddPerson(false)}
          onAdd={(name) => {
            const c = findOrCreateCustomer({ name, phone: "" });
            addParticipant(table.id, c.id);
            setShowAddPerson(false);
          }}
        />
      )}

      {showLoserPicker && (
        <Modal title="Who lost?" onClose={() => setShowLoserPicker(false)}>
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-text-faint)]">
              Whole bill goes on their tab — everyone else played free this round.
            </p>
            <div className="space-y-2">
              {participants.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setShowLoserPicker(false);
                    handleStopAndBill(undefined, { customerId: p.id, name: p.name });
                  }}
                  className="w-full flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-left"
                >
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-[var(--color-danger)]">Pays {formatMoney(total, currency)}</span>
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function AddPersonModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState("");

  function handleAdd() {
    if (!name.trim()) return;
    onAdd(name.trim());
  }

  return (
    <Modal title="Add person" onClose={onClose}>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-3 text-base outline-none focus:border-[var(--color-primary)]"
        />
        <button
          onClick={handleAdd}
          disabled={!name.trim()}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] disabled:opacity-40 text-white font-semibold py-3"
        >
          <UserPlus size={16} /> Add to this table
        </button>
      </div>
    </Modal>
  );
}
