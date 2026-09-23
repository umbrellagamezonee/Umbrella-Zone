import type { BillingTable } from "../types";

export function tableElapsedMs(table: BillingTable, now: number) {
  if (table.status === "running" && table.sessionStartedAt) {
    return table.accumulatedMs + (now - table.sessionStartedAt);
  }
  return table.accumulatedMs;
}

export function activeRate(table: BillingTable) {
  return table.sessionRatePerHour ?? table.ratePerHour;
}
