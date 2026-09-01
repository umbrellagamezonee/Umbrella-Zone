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
import { Plus, Minus, Users, UserPlus, Search, Frown, Pencil, Check, Pause, Play } from "lucide-react";

// Splits `total` equally among `n` payers down to the paisa, handing any
// leftover paisa to the first few payers so the shares always add back up
// exactly (floating-point division alone can leave the sum a paisa short).
function splitEqually(total: number, names: string[], label = "Share") {
  const n = names.length;
  const totalPaise = Math.round(total * 100);
  const base = Math.floor(totalPaise / n);
  const remainder = totalPaise - base * n;
  return names.map((name, i) => ({
    label,
    payerName: name,
    amount: (base + (i < remainder ? 1 : 0)) / 100,
  }));
}

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
  const pauseSession = useTablesStore((s) => s.pauseSession);
  const resumeSession = useTablesStore((s) => s.resumeSession);
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
  const [selectedLoserIds, setSelectedLoserIds] = useState<string[]>([]);
  const [showEditTime, setShowEditTime] = useState(false);
  // Which participant new canteen items get tagged to — null means "shared /
  // no one specific". Only shown once there's more than one person here.
  const [addForId, setAddForId] = useState<string | null>(null);
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
    const forName = addForId ? participants.find((p) => p.id === addForId)?.name ?? null : null;
    addItem(o.id, { menuItemId: item.id, name: item.name, price: item.price, qty: 1, personName: forName });
  }

  function handleStopAndBill(
    shares?: { label: string; payerName: string; amount: number }[],
    losers?: { customerId: string; name: string }[]
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
      customerId: losers?.length === 1 ? losers[0].customerId : table.customerId,
      tableChargeMinutes: minutesBilled,
      tableCharge,
      canteenCharge: canteenTotal,
      canteenItems:
        order?.items.map((i) => ({ name: i.name, price: i.price, qty: i.qty, personName: i.personName ?? null })) ?? [],
      discount: shares ? 0 : effectiveDiscount,
      shares,
      matchParticipants: participantNames.length > 1 ? participantNames : null,
      matchLosers: losers && losers.length > 0 ? losers.map((l) => l.name) : null,
    });
    if (order) markBilled(order.id);
    // Tracked for every path, split included — cancelCheckout below only
    // actually reverts while nothing on the bill has been paid yet.
    setUndo({ tableSnapshot, orderId: order?.id ?? null, billId: bill.id });
    setCheckoutBill(bill);
  }

  function cancelCheckout() {
    if (undo) {
      // Re-check against the live bill (not the stale snapshot in
      // `checkoutBill`) — a split bill can pick up a paid share any time
      // while this screen is open, and once that's happened reverting would
      // silently swallow money already collected. Safe to fully undo only
      // while nothing on it has been paid yet.
      const liveBill = useBillsStore.getState().bills.find((b) => b.id === undo.billId);
      const anyPaid = liveBill
        ? liveBill.shares
          ? liveBill.shares.some((s) => s.status === "paid")
          : liveBill.status === "paid" || liveBill.amountPaid > 0
        : true;
      if (!anyPaid) {
        updateTable(table.id, undo.tableSnapshot);
        if (undo.orderId) unmarkBilled(undo.orderId);
        deleteBill(undo.billId);
      }
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
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold font-mono">{formatDuration(elapsed)}</p>
                  {table.status !== "available" && (
                    <button
                      onClick={() => setShowEditTime(true)}
                      className="h-6 w-6 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-dim)] shrink-0"
                      title="Edit elapsed time"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
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

          {(table.status === "running" || table.status === "paused") && (
            <button
              onClick={() => (table.status === "running" ? pauseSession(table.id) : resumeSession(table.id))}
              className={
                "w-full flex items-center justify-center gap-2 rounded-xl border text-sm font-medium py-2.5 " +
                (table.status === "running"
                  ? "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                  : "border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]")
              }
            >
              {table.status === "running" ? (
                <>
                  <Pause size={15} /> Hold this session
                </>
              ) : (
                <>
                  <Play size={15} /> Resume session
                </>
              )}
            </button>
          )}

          <details className="group">
            <summary className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] cursor-pointer select-none py-1">
              ADD FROM MENU
            </summary>
            <div className="mt-2">
              {participants.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="text-xs text-[var(--color-text-faint)] self-center mr-0.5">Adding for:</span>
                  <button
                    onClick={() => setAddForId(null)}
                    className={
                      "text-xs rounded-full border px-2.5 py-1 " +
                      (addForId === null
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-dim)]")
                    }
                  >
                    Shared
                  </button>
                  {participants.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setAddForId(p.id)}
                      className={
                        "text-xs rounded-full border px-2.5 py-1 " +
                        (addForId === p.id
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                          : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-dim)]")
                      }
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
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
                    // Summed across every line for this item — the same dish
                    // can now be split into separate lines per person.
                    const qtyInOrder =
                      order?.items
                        .filter((i) => i.menuItemId === item.id)
                        .reduce((sum, i) => sum + i.qty, 0) ?? 0;
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
                      <p className="text-sm">
                        {line.name}
                        {line.personName && (
                          <span className="text-[var(--color-text-faint)]"> · {line.personName}</span>
                        )}
                      </p>
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
            <Users size={15} /> Split by item
          </button>
          {participants.length > 1 && (
            <button
              onClick={() => handleStopAndBill(splitEqually(total, participantNames))}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm font-medium py-2.5"
            >
              <Users size={15} /> Split equally ·{" "}
              {formatMoney(total / participantNames.length, currency)} each
            </button>
          )}
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
        <SplitCheckout bill={checkoutBill} onDone={cancelCheckout} />
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
        <Modal
          title="Who lost?"
          onClose={() => {
            setShowLoserPicker(false);
            setSelectedLoserIds([]);
          }}
        >
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-text-faint)]">
              Pick everyone who lost — the bill splits equally between them. Everyone else played
              free this round.
            </p>
            <div className="space-y-2">
              {participants.map((p) => {
                const checked = selectedLoserIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() =>
                      setSelectedLoserIds((ids) =>
                        checked ? ids.filter((id) => id !== p.id) : [...ids, p.id]
                      )
                    }
                    className={
                      "w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left " +
                      (checked
                        ? "border-[var(--color-danger)] bg-[var(--color-danger)]/10"
                        : "border-[var(--color-border)] bg-[var(--color-surface-2)]")
                    }
                  >
                    <span
                      className={
                        "h-5 w-5 rounded-md border flex items-center justify-center shrink-0 " +
                        (checked
                          ? "border-[var(--color-danger)] bg-[var(--color-danger)]"
                          : "border-[var(--color-border)]")
                      }
                    >
                      {checked && <Check size={13} className="text-white" />}
                    </span>
                    <span className="text-sm font-medium flex-1">{p.name}</span>
                  </button>
                );
              })}
            </div>
            {selectedLoserIds.length > 0 && (
              <p className="text-xs text-[var(--color-text-dim)] text-center">
                {selectedLoserIds.length === 1
                  ? `Pays full ${formatMoney(total, currency)}`
                  : `${selectedLoserIds.length} losers · ${formatMoney(
                      total / selectedLoserIds.length,
                      currency
                    )} each`}
              </p>
            )}
            <button
              onClick={() => {
                const losers = participants
                  .filter((p) => selectedLoserIds.includes(p.id))
                  .map((p) => ({ customerId: p.id, name: p.name }));
                setShowLoserPicker(false);
                setSelectedLoserIds([]);
                if (losers.length <= 1) {
                  handleStopAndBill(undefined, losers);
                } else {
                  handleStopAndBill(
                    splitEqually(total, losers.map((l) => l.name), "Loser share"),
                    losers
                  );
                }
              }}
              disabled={selectedLoserIds.length === 0}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-danger)] disabled:opacity-40 text-white font-semibold py-3"
            >
              <Frown size={15} />
              Bill {selectedLoserIds.length || ""} loser{selectedLoserIds.length === 1 ? "" : "s"}
            </button>
          </div>
        </Modal>
      )}

      {showEditTime && (
        <EditTimeModal
          currentMs={elapsed}
          onClose={() => setShowEditTime(false)}
          onSave={(newMs) => {
            updateTable(table.id, {
              accumulatedMs: newMs,
              ...(table.status === "running" ? { sessionStartedAt: now } : {}),
            });
            setShowEditTime(false);
          }}
        />
      )}
    </Modal>
  );
}

function EditTimeModal({
  currentMs,
  onClose,
  onSave,
}: {
  currentMs: number;
  onClose: () => void;
  onSave: (ms: number) => void;
}) {
  const totalMinutes = Math.round(currentMs / 60000);
  const [hours, setHours] = useState(String(Math.floor(totalMinutes / 60)));
  const [minutes, setMinutes] = useState(String(totalMinutes % 60));

  function handleSave() {
    const h = Math.max(0, Number(hours) || 0);
    const m = Math.max(0, Math.min(59, Number(minutes) || 0));
    onSave((h * 60 + m) * 60000);
  }

  return (
    <Modal title="Edit elapsed time" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--color-text-faint)]">
          Correct the timer if it was started late or a pause was missed — billing uses this
          duration.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-[var(--color-text-dim)] mb-1">Hours</p>
            <input
              type="number"
              min={0}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none text-center"
            />
          </div>
          <div className="flex-1">
            <p className="text-xs text-[var(--color-text-dim)] mb-1">Minutes</p>
            <input
              type="number"
              min={0}
              max={59}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none text-center"
            />
          </div>
        </div>
        <button
          onClick={handleSave}
          className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
        >
          Save
        </button>
      </div>
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
