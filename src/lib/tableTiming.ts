import type { BillingTable } from "../types";

// A session running or paused this long is almost certainly one nobody
// stopped — left running overnight, or paused and forgotten about — rather
// than someone genuinely playing for hours straight. Deliberately a much
// higher bar than the planned session length (60m by default), which is
// routinely and harmlessly exceeded and isn't itself a sign anything's
// wrong.
export const STUCK_SESSION_MS = 4 * 60 * 60 * 1000;

export function tableElapsedMs(table: BillingTable, now: number) {
  if (table.status === "running" && table.sessionStartedAt) {
    return table.accumulatedMs + (now - table.sessionStartedAt);
  }
  return table.accumulatedMs;
}

export function activeRate(table: BillingTable) {
  return table.sessionRatePerHour ?? table.ratePerHour;
}
