import { useState } from "react";
import { Modal } from "./ui/Modal";
import { PhoneInput } from "./ui/PhoneInput";
import { useTablesStore } from "../store/useTablesStore";
import { useGamesStore } from "../store/useGamesStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney } from "../lib/format";
import type { BillingTable } from "../types";
import { Play, Plus, X } from "lucide-react";

interface PersonRow {
  key: number;
  name: string;
  phone: string;
}

let rowKeySeq = 0;
function newRow(): PersonRow {
  return { key: rowKeySeq++, name: "", phone: "" };
}

// The fast path for starting a session: tap a table, type a name, go. More
// people can be added below for a shared session (e.g. a few friends on one
// table) — the first name is the primary contact, the rest are tracked for
// record-keeping and as quick picks when splitting the bill later.
export function StartSessionModal({ table, onClose }: { table: BillingTable; onClose: () => void }) {
  const startSession = useTablesStore((s) => s.startSession);
  const games = useGamesStore((s) => s.games);
  const findOrCreateCustomer = useCustomersStore((s) => s.findOrCreateCustomer);
  const orders = useOrdersStore((s) => s.orders);
  const reassignToTable = useOrdersStore((s) => s.reassignToTable);
  const currency = useSettingsStore((s) => s.currencySymbol);

  const [people, setPeople] = useState<PersonRow[]>([newRow()]);
  const [gameId, setGameId] = useState("");

  const gamesForTable = games.filter((g) => g.kind === table.kind);
  const selectedGame = gamesForTable.find((g) => g.id === gameId) ?? null;
  const canStart = people.some((p) => p.name.trim().length > 0);

  function updatePerson(key: number, patch: Partial<PersonRow>) {
    setPeople((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removePerson(key: number) {
    setPeople((rows) => rows.filter((r) => r.key !== key));
  }

  function handleStart() {
    const named = people.filter((p) => p.name.trim().length > 0);
    if (named.length === 0) return;
    const customers = named.map((p) => findOrCreateCustomer({ name: p.name, phone: p.phone }));
    const [primary, ...extra] = customers;
    startSession(table.id, primary.id, {
      gameId: selectedGame?.id ?? null,
      ratePerHour: selectedGame?.ratePerHour ?? null,
      extraCustomerIds: extra.map((c) => c.id),
    });

    // They may have eaten before picking a table — fold any of their
    // unbilled standalone food orders into this table's tab automatically.
    for (const c of customers) {
      const pendingOrder = orders.find(
        (o) =>
          o.tableId === null &&
          o.status !== "billed" &&
          (o.customerId === c.id ||
            (o.guestName && o.guestName.trim().toLowerCase() === c.name.trim().toLowerCase()))
      );
      if (pendingOrder) reassignToTable(pendingOrder.id, table.id, primary.id);
    }

    onClose();
  }

  return (
    <Modal title={table.name} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-[var(--color-text-dim)]">
          {table.kind} · {formatMoney(table.ratePerHour, currency)}/hr · {table.defaultSessionMinutes} min session
        </p>

        <div className="space-y-2">
          {people.map((row, i) => (
            <div key={row.key} className="flex items-center gap-2">
              <input
                value={row.name}
                onChange={(e) => updatePerson(row.key, { name: e.target.value })}
                placeholder={i === 0 ? "Name" : "Another name"}
                autoFocus={i === 0}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                className="flex-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-3 text-base outline-none focus:border-[var(--color-primary)]"
              />
              {people.length > 1 && (
                <button
                  onClick={() => removePerson(row.key)}
                  className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-dim)] shrink-0"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={() => setPeople((rows) => [...rows, newRow()])}
          className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)]"
        >
          <Plus size={14} /> Add another person
        </button>

        <button
          onClick={handleStart}
          disabled={!canStart}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] disabled:opacity-40 text-white font-semibold py-3"
        >
          <Play size={16} /> Start
        </button>

        <details className="pt-1">
          <summary className="text-xs text-[var(--color-text-faint)] cursor-pointer select-none">
            Phone / game (optional)
          </summary>
          <div className="space-y-2 mt-2">
            {people.map((row) => (
              <PhoneInput
                key={row.key}
                value={row.phone}
                onChange={(v) => updatePerson(row.key, { phone: v })}
                className={row.name.trim() ? "" : "opacity-60"}
              />
            ))}
            {gamesForTable.length > 0 && (
              <select
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
              >
                <option value="">Default table rate</option>
                {gamesForTable.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · {formatMoney(g.ratePerHour, currency)}/hr
                  </option>
                ))}
              </select>
            )}
          </div>
        </details>
      </div>
    </Modal>
  );
}
