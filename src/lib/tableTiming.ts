import type { BillingTable } from "../types";

export function tableElapsedMs(table: BillingTable, now: number) {
  if (table.status === "running" && table.sessionStartedAt) {
    return table.accumulatedMs + (now - table.sessionStartedAt);
  }
  return table.accumulatedMs;
}

export function tableRemainingMs(table: BillingTable, now: number) {
  if (table.plannedDurationMs == null) return null;
  return table.plannedDurationMs - tableElapsedMs(table, now);
}

export function activeRate(table: BillingTable) {
  return table.sessionRatePerHour ?? table.ratePerHour;
}
