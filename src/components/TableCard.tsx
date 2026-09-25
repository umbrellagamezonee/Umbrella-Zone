import { Card } from "./ui/Card";
import { useCustomersStore } from "../store/useCustomersStore";
import { useGamesStore } from "../store/useGamesStore";
import { useTablesStore } from "../store/useTablesStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatDuration, formatMoney } from "../lib/format";
import { tableElapsedMs, activeRate, STUCK_SESSION_MS } from "../lib/tableTiming";
import { costForElapsed } from "../lib/format";
import type { BillingTable } from "../types";
import { Play, Pause, Gamepad2, AlertTriangle } from "lucide-react";

export function TableCard({
  table,
  now,
  onOpenDetail,
  onStart,
}: {
  table: BillingTable;
  now: number;
  onOpenDetail: (table: BillingTable) => void;
  onStart: (table: BillingTable) => void;
}) {
  const customers = useCustomersStore((s) => s.customers);
  const games = useGamesStore((s) => s.games);
  const pauseSession = useTablesStore((s) => s.pauseSession);
  const resumeSession = useTablesStore((s) => s.resumeSession);
  const currency = useSettingsStore((s) => s.currencySymbol);

  const elapsed = tableElapsedMs(table, now);
  const rate = activeRate(table);
  const cost = costForElapsed(elapsed, rate);
  const customer = customers.find((c) => c.id === table.customerId);
  const extraCount = table.extraCustomerIds.length;
  const game = games.find((g) => g.id === table.activeGameId);
  const stuck = table.status !== "available" && elapsed > STUCK_SESSION_MS;
  return (
    <Card
      onClick={() => (table.status === "available" ? onStart(table) : onOpenDetail(table))}
      className={
        stuck
          ? "border-[var(--color-danger)]"
          : table.status === "running"
          ? "border-[var(--color-success)]/50"
          : table.status === "paused"
          ? "border-[var(--color-warning)]/50"
          : ""
      }
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold">{table.name}</p>
          <p className="text-xs text-[var(--color-text-dim)]">
            {table.kind} · {formatMoney(table.ratePerHour, currency)}/hr · {table.defaultSessionMinutes}m default
          </p>
        </div>
        <span
          className={
            "text-[11px] font-medium rounded-full px-2.5 py-1 " +
            (table.status === "running"
              ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
              : table.status === "paused"
              ? "bg-[var(--color-warning)]/15 text-[var(--color-warning)]"
              : "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]")
          }
        >
          {table.status === "running" ? "Running" : table.status === "paused" ? "Paused" : "Available"}
        </span>
      </div>

      {table.status !== "available" && (
        <div className="mt-3 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold font-mono">{formatDuration(elapsed)}</p>
            <p className="text-xs text-[var(--color-text-dim)]">
              {customer ? customer.name : "Walk-in"}
              {extraCount > 0 && ` +${extraCount}`} · {formatMoney(cost, currency)}
            </p>
            {game && (
              <p className="text-xs text-[var(--color-accent)] flex items-center gap-1 mt-0.5">
                <Gamepad2 size={11} /> {game.name} · {formatMoney(rate, currency)}/hr
              </p>
            )}
            {stuck && (
              <p className="text-xs text-[var(--color-danger)] font-medium flex items-center gap-1 mt-0.5">
                <AlertTriangle size={11} /> Running very long — check before billing
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {table.status === "running" ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  pauseSession(table.id);
                }}
                className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning)]"
              >
                <Pause size={16} />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resumeSession(table.id);
                }}
                className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)]"
              >
                <Play size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      {table.status === "available" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStart(table);
          }}
          className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold py-2.5"
        >
          <Play size={16} /> Start
        </button>
      )}
    </Card>
  );
}
