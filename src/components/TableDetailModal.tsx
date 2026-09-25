import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Card } from "./ui/Card";
import { SplitCheckout } from "./SplitCheckout";
import { Checkout } from "./Checkout";
import { CustomerNameInput } from "./ui/CustomerNameInput";
import { useTablesStore } from "../store/useTablesStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useMenuStore } from "../store/useMenuStore";
import { useGamesStore } from "../store/useGamesStore";
import { useBillsStore } from "../store/useBillsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatDuration, formatMoney, elapsedMinutesExact, costForElapsed } from "../lib/format";
import { tableElapsedMs, activeRate, STUCK_SESSION_MS } from "../lib/tableTiming";
import type { BillingTable, Bill } from "../types";
import { Plus, Minus, UserPlus, Pencil, Check, Pause, Play, Gamepad2, AlertTriangle } from "lucide-react";

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
  const startSession = useTablesStore((s) => s.startSession);
  const pauseSession = useTablesStore((s) => s.pauseSession);
  const resumeSession = useTablesStore((s) => s.resumeSession);
  const addParticipant = useTablesStore((s) => s.addParticipant);
  const updateTable = useTablesStore((s) => s.updateTable);
  const menuItems = useMenuStore((s) => s.items);
  const orders = useOrdersStore((s) => s.orders);
  const changeQty = useOrdersStore((s) => s.changeQty);
  const createOpenBill = useBillsStore((s) => s.createOpenBill);
  const deleteBill = useBillsStore((s) => s.deleteBill);
  const markBilled = useOrdersStore((s) => s.markBilled);
  const unmarkBilled = useOrdersStore((s) => s.unmarkBilled);

  const [discount, setDiscount] = useState(0);
  const [checkoutBill, setCheckoutBill] = useState<Bill | null>(null);
  const [showAddPerson, setShowAddPerson] = useState(false);
  // Who's actually paying this bill — asked before Stop & Bill whenever more
  // than one person is at the table. Starts with everyone ticked (equal
  // split); untick anyone who isn't paying their own way.
  const [showPayerPicker, setShowPayerPicker] = useState(false);
  const [selectedPayerIds, setSelectedPayerIds] = useState<string[]>([]);
  const [showEditTime, setShowEditTime] = useState(false);
  const [showGamePicker, setShowGamePicker] = useState(false);
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
  const gamesForTable = games.filter((g) => g.kind === table.kind);
  const elapsed = tableElapsedMs(table, now);
  const stuck = table.status !== "available" && elapsed > STUCK_SESSION_MS;
  const minutesBilled = elapsedMinutesExact(elapsed);
  const tableCharge = table.status === "available" ? 0 : costForElapsed(elapsed, rate);
  // Clamp against the raw input in case items/time changed after the discount was typed
  // (e.g. a canteen item removed) — the bill total must never go negative.
  const effectiveDiscount = Math.min(discount, tableCharge + canteenTotal);
  const total = tableCharge + canteenTotal - effectiveDiscount;

  // `payers` is who actually owes this bill — everyone at the table when
  // nobody's picked out specially (equal split), or a chosen few (the rest
  // played free this round). One payer bills straight to their account; two
  // or more split the total equally between just them.
  function handleStopAndBill(payers: { id: string; name: string }[]) {
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
    // Table charge and food are billed (and so payable) separately rather
    // than as one lump sum — discount comes off the table charge first,
    // spilling over into food only if it's bigger than the table charge
    // alone. Same split among `payers` either way; this just keeps the two
    // kinds of cost visibly and individually settleable, even for a single
    // payer.
    const tableAfterDiscount = Math.max(0, tableCharge - effectiveDiscount);
    const discountSpillover = Math.max(0, effectiveDiscount - tableCharge);
    const foodAfterDiscount = Math.max(0, canteenTotal - discountSpillover);
    // A shares-based bill is needed whenever there's more than one payer, OR
    // there's food alongside the table charge to keep separate — a
    // table-only single-payer bill keeps the simple customerId path.
    const needsShares = payers.length > 1 || canteenTotal > 0;
    const shares =
      needsShares && payers.length > 0
        ? [
            ...splitEqually(tableAfterDiscount, payers.map((p) => p.name), "Table charge"),
            ...(canteenTotal > 0 ? splitEqually(foodAfterDiscount, payers.map((p) => p.name), "Food") : []),
          ]
        : undefined;
    // A strict subset paying (not everyone) is the "someone else played
    // free" case — worth recording as who lost, same as before.
    const partial = payers.length > 0 && payers.length < participants.length;
    stopSession(table.id);
    const bill = createOpenBill({
      tableId: table.id,
      tableName: table.name,
      gameId: game?.id ?? null,
      gameName: game?.name ?? null,
      customerId: !needsShares && payers.length === 1 ? payers[0].id : table.customerId,
      tableChargeMinutes: minutesBilled,
      tableCharge,
      canteenCharge: canteenTotal,
      canteenItems:
        order?.items.map((i) => ({ name: i.name, price: i.price, qty: i.qty, personName: i.personName ?? null })) ?? [],
      discount: effectiveDiscount,
      shares,
      matchParticipants: participantNames.length > 1 ? participantNames : null,
      matchLosers: partial ? payers.map((p) => p.name) : null,
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
      // Same idea for the table itself — Stop & Bill freed it up the instant
      // it was pressed, so someone on another device could already have
      // started a brand new session on it while this checkout screen was
      // open. Restoring the pre-stop snapshot in that case would stomp their
      // live session. Only safe to restore while the table's still exactly
      // as Stop & Bill left it (available, nobody on it).
      const liveTable = useTablesStore.getState().tables.find((t) => t.id === table.id);
      const reoccupied = !!liveTable && (liveTable.status !== "available" || liveTable.customerId != null);
      if (!anyPaid && !reoccupied) {
        updateTable(table.id, undo.tableSnapshot);
        if (undo.orderId) unmarkBilled(undo.orderId);
        deleteBill(undo.billId);
      } else if (!anyPaid) {
        // Table's back in use by someone else — still clean up this
        // abandoned bill/order rather than leaving it dangling.
        if (undo.orderId) unmarkBilled(undo.orderId);
        deleteBill(undo.billId);
      }
      setUndo(null);
    }
    setCheckoutBill(null);
  }

  // Offered once the bill is settled: leaves it exactly as paid (still shows
  // up in Home/Reports/that customer's history) and starts a fresh session
  // right away for the same players, same game, timer back at zero.
  function doRestart() {
    if (!checkoutBill?.tableId || !checkoutBill.matchParticipants?.length) return;
    // The table could have been picked up by someone else while this bill
    // was being paid (it's shown "available" since Stop & Bill) — never
    // stomp a session already running on it.
    if (table.status !== "available") return;
    const [primaryName, ...restNames] = checkoutBill.matchParticipants;
    const primary = findOrCreateCustomer({ name: primaryName, phone: "" });
    const extraCustomerIds = restNames.map((name) => findOrCreateCustomer({ name, phone: "" }).id);
    const restartGame = checkoutBill.gameId ? games.find((g) => g.id === checkoutBill.gameId) : undefined;
    startSession(checkoutBill.tableId, primary.id, {
      extraCustomerIds,
      gameId: restartGame?.id ?? null,
      ratePerHour: restartGame?.ratePerHour ?? null,
    });
    setUndo(null);
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
                  {gamesForTable.length > 0 && (
                    <button
                      onClick={() => setShowGamePicker(true)}
                      className="h-5 w-5 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-primary)] shrink-0"
                      title={game ? "Change game" : "Set a game"}
                    >
                      <Gamepad2 size={11} />
                    </button>
                  )}
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
              </div>
              <div className="text-right">
                <p className="text-xs text-[var(--color-text-dim)]">
                  Table charge · {formatMoney(rate, currency)}/hr
                </p>
                <p className="text-lg font-bold">{formatMoney(tableCharge, currency)}</p>
              </div>
            </div>
            {stuck && (
              <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-xs font-medium px-2.5 py-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>
                  This has been running for {formatDuration(elapsed)} — likely nobody stopped it earlier.
                  Tap the pencil above to fix the time before billing.
                </span>
              </div>
            )}
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
            onClick={() => {
              if (participants.length > 1) {
                setSelectedPayerIds(participants.map((p) => p.id));
                setShowPayerPicker(true);
              } else {
                handleStopAndBill(participants);
              }
            }}
            className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
          >
            Stop & Bill · {formatMoney(total, currency)}
          </button>
        </div>
      ) : checkoutBill.shares ? (
        <SplitCheckout bill={checkoutBill} onDone={cancelCheckout} />
      ) : (
        <Checkout
          bill={checkoutBill}
          onDone={onClose}
          onCancel={undo ? cancelCheckout : undefined}
          onSettled={() => setUndo(null)}
          onRestart={
            checkoutBill.matchParticipants &&
            checkoutBill.matchParticipants.length > 1 &&
            table.status === "available"
              ? doRestart
              : undefined
          }
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

      {showPayerPicker && (
        <Modal
          title="Who's paying?"
          onClose={() => {
            setShowPayerPicker(false);
            setSelectedPayerIds([]);
          }}
        >
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-text-faint)]">
              Tick everyone who's paying their own way — the bill splits equally between just
              them. Untick anyone who played free this round (someone else covers their share).
            </p>
            <div className="space-y-2">
              {participants.map((p) => {
                const checked = selectedPayerIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() =>
                      setSelectedPayerIds((ids) =>
                        checked ? ids.filter((id) => id !== p.id) : [...ids, p.id]
                      )
                    }
                    className={
                      "w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left " +
                      (checked
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                        : "border-[var(--color-border)] bg-[var(--color-surface-2)]")
                    }
                  >
                    <span
                      className={
                        "h-5 w-5 rounded-md border flex items-center justify-center shrink-0 " +
                        (checked
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
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
            {selectedPayerIds.length > 0 && (
              <p className="text-xs text-[var(--color-text-dim)] text-center">
                {selectedPayerIds.length === 1
                  ? `Pays the full ${formatMoney(total, currency)}`
                  : `${selectedPayerIds.length} people · ${formatMoney(
                      total / selectedPayerIds.length,
                      currency
                    )} each`}
              </p>
            )}
            <button
              onClick={() => {
                const payers = participants.filter((p) => selectedPayerIds.includes(p.id));
                setShowPayerPicker(false);
                setSelectedPayerIds([]);
                handleStopAndBill(payers);
              }}
              disabled={selectedPayerIds.length === 0}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] disabled:opacity-40 text-white font-semibold py-3"
            >
              <Check size={15} />
              Bill {selectedPayerIds.length || ""} {selectedPayerIds.length === 1 ? "person" : "people"}
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

      {showGamePicker && (
        <GamePickerModal
          games={gamesForTable}
          currentGameId={table.activeGameId}
          currency={currency}
          onClose={() => setShowGamePicker(false)}
          onSave={(newGameId) => {
            const newGame = gamesForTable.find((g) => g.id === newGameId) ?? null;
            updateTable(table.id, {
              activeGameId: newGame?.id ?? null,
              sessionRatePerHour: newGame?.ratePerHour ?? null,
            });
            setShowGamePicker(false);
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

function GamePickerModal({
  games,
  currentGameId,
  currency,
  onClose,
  onSave,
}: {
  games: { id: string; name: string; ratePerHour: number }[];
  currentGameId: string | null;
  currency: string;
  onClose: () => void;
  onSave: (gameId: string) => void;
}) {
  const [gameId, setGameId] = useState(currentGameId ?? "");

  return (
    <Modal title="Change Game" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--color-text-faint)]">
          The new rate applies to this whole session, including time already played — for a
          clean split at the old rate, Stop &amp; Bill first, then start fresh with the new game.
        </p>
        <select
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          autoFocus
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
        >
          <option value="">Default table rate</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} · {formatMoney(g.ratePerHour, currency)}/hr
            </option>
          ))}
        </select>
        <button
          onClick={() => onSave(gameId)}
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
        <CustomerNameInput value={name} onChange={setName} placeholder="Name" autoFocus onEnter={handleAdd} />
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
