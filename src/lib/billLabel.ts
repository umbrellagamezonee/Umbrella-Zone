import type { Bill, Customer } from "../types";

// The person a bill belongs to, for showing at the top of a card or detail:
// whoever actually lost (and so is paying) when this was a "loser pays"
// match, else the registered customer if there is one, else whoever was
// snapshotted as the first player, else the free-text name a walk-in gave —
// and only "Walk-in" as a last resort. Never the internal "Canteen order"
// placeholder that canteen bills carry in their tableName slot.
//
// matchLosers has to come first: when 2+ people split a "loser pays" bill,
// bill.customerId still points at whoever started the session (see
// TableDetailModal's handleStopAndBill) — which is often the winner, not
// anyone actually paying. Only a single-loser bill happens to get customerId
// right on its own; checking matchLosers first makes both cases correct.
export function billPersonName(bill: Bill, customer: Customer | undefined): string {
  if (bill.matchLosers && bill.matchLosers.length > 0) return bill.matchLosers.join(", ");
  if (customer && !customer.isWalkIn) return customer.name;
  if (bill.matchParticipants && bill.matchParticipants.length > 0) return bill.matchParticipants[0];
  if (!bill.tableId && bill.tableName && bill.tableName !== "Canteen order") return bill.tableName;
  return "Walk-in";
}

// Where the bill came from — the table's name for a session, "Canteen" for a
// standalone food order, or the special "Credit settlement" marker for a
// balance payment.
export function billPlace(bill: Bill): string {
  if (bill.tableId) return bill.tableName ?? "Table";
  if (bill.tableName === "Credit settlement") return "Credit settlement";
  return "Canteen";
}

export function isCreditSettlement(bill: Bill): boolean {
  return !bill.tableId && bill.tableName === "Credit settlement";
}
