import type { Bill, CanteenOrder, Customer } from "../types";
import { normalizeName } from "./customerName";

// Two laptops each keep their own data. This brings the data of ANOTHER laptop's
// backup file into this one — it only ever ADDS what is missing, nothing here is
// deleted or overwritten, and doing it twice changes nothing the second time.
//
//   bills, orders, expenses      added when this laptop doesn't have that record yet
//   a bill / order both have     the further-along version wins (paid beats open,
//                                billed beats served); anything unclear is left as it
//                                is here and listed under `conflicts`
//   customers                    the same person already here (same id, or exactly the
//                                same name once spaces / capitals are ignored) is NOT
//                                added again — the other laptop's bills for them are
//                                moved onto the one that is here; a new name is added
//   menu, tables, games          only what is missing is added (stock, running tables and
//                                settings of this laptop are never touched)
//
// Works on the saved text of each store (the same format as Settings -> Backup &
// Restore) and returns only the keys that changed.

export interface MergeSummary {
  billsAdded: number;
  billsUpdated: number;
  deletedBillsAdded: number;
  ordersAdded: number;
  ordersUpdated: number;
  customersAdded: number;
  customersMatchedByName: number;
  expensesAdded: number;
  menuItemsAdded: number;
  tablesAdded: number;
  gamesAdded: number;
  conflicts: string[];
}

type Doc = { state: Record<string, unknown>; version?: number };

function readDoc(map: Record<string, string>, key: string): Doc | null {
  const raw = map[key];
  if (typeof raw !== "string") return null;
  try {
    const d = JSON.parse(raw) as Doc;
    return d && typeof d === "object" && d.state && typeof d.state === "object" ? d : null;
  } catch {
    return null;
  }
}

const list = <T,>(doc: Doc | null, field: string): T[] => {
  const v = doc?.state[field];
  return Array.isArray(v) ? (v as T[]) : [];
};

const billRank = (b: Bill): number =>
  (b.status === "paid" ? 1000 : 0) + (b.shares ? b.shares.filter((s) => s.status === "paid").length : 0);
const orderRank = (o: CanteenOrder): number => (o.status === "billed" ? 2 : o.status === "served" ? 1 : 0);

export function mergeBackups(
  local: Record<string, string>,
  incoming: Record<string, string>
): { merged: Record<string, string>; summary: MergeSummary } {
  const summary: MergeSummary = {
    billsAdded: 0,
    billsUpdated: 0,
    deletedBillsAdded: 0,
    ordersAdded: 0,
    ordersUpdated: 0,
    customersAdded: 0,
    customersMatchedByName: 0,
    expensesAdded: 0,
    menuItemsAdded: 0,
    tablesAdded: 0,
    gamesAdded: 0,
    conflicts: [],
  };
  const merged: Record<string, string> = {};
  const note = (text: string) => {
    if (summary.conflicts.length < 30) summary.conflicts.push(text);
  };

  // ---------------- customers (first: bills and orders follow them) ----------------
  const custLocal = readDoc(local, "cuebill-customers");
  const custIn = readDoc(incoming, "cuebill-customers");
  const alias = new Map<string, string>(); // other laptop's customer id -> the one here
  if (custIn) {
    const doc: Doc = custLocal ?? { state: { customers: [], pendingMerges: {} }, version: custIn.version };
    const customers = [...list<Customer>(doc, "customers")];
    const byId = new Map(customers.map((c, i) => [c.id, i]));
    const byName = new Map<string, Customer>();
    for (const c of customers) if (!c.isWalkIn && !byName.has(normalizeName(c.name))) byName.set(normalizeName(c.name), c);
    let changed = false;
    for (const c of list<Customer>(custIn, "customers")) {
      if (c.isWalkIn) continue;
      const here = byId.get(c.id);
      if (here !== undefined) {
        // the same record: keep this laptop's, but a "regular" mark from either laptop stays
        if (c.isRegular && !customers[here].isRegular) {
          customers[here] = { ...customers[here], isRegular: true };
          changed = true;
        }
        continue;
      }
      const sameName = byName.get(normalizeName(c.name));
      if (sameName) {
        alias.set(c.id, sameName.id);
        summary.customersMatchedByName++;
        if (c.isRegular && !sameName.isRegular) {
          const i = byId.get(sameName.id)!;
          customers[i] = { ...customers[i], isRegular: true };
          sameName.isRegular = true;
          changed = true;
        }
        continue;
      }
      customers.push(c);
      byId.set(c.id, customers.length - 1);
      byName.set(normalizeName(c.name), c);
      summary.customersAdded++;
      changed = true;
    }
    if (changed) merged["cuebill-customers"] = JSON.stringify({ ...doc, state: { ...doc.state, customers } });
  }
  const mapCustomer = (id: string | null): string | null => (id && alias.has(id) ? alias.get(id)! : id);

  // ---------------- bills ----------------
  const billsLocal = readDoc(local, "cuebill-bills");
  const billsIn = readDoc(incoming, "cuebill-bills");
  if (billsIn) {
    const doc: Doc = billsLocal ?? { state: { bills: [], deletedBills: [], pendingBillIds: {} }, version: billsIn.version };
    const bills = [...list<Bill>(doc, "bills")];
    const deleted = [...list<Bill>(doc, "deletedBills")];
    const at = new Map(bills.map((b, i) => [b.id, i]));
    const deletedIds = new Set(deleted.map((b) => b.id));
    let changed = false;
    for (const raw of list<Bill>(billsIn, "bills")) {
      const b = raw.customerId && alias.has(raw.customerId) ? { ...raw, customerId: mapCustomer(raw.customerId) } : raw;
      const i = at.get(b.id);
      if (i === undefined) {
        if (deletedIds.has(b.id)) {
          note("Ek bill is laptop par delete hua hai aur dusre par chal raha hai - delete wala hi rakha.");
          continue;
        }
        bills.push(b);
        at.set(b.id, bills.length - 1);
        summary.billsAdded++;
        changed = true;
        continue;
      }
      const mine = bills[i];
      if (JSON.stringify(mine) === JSON.stringify(b)) continue;
      if (mine.status === "cancelled" || b.status === "cancelled") {
        if (mine.status !== b.status) note("Ek bill ek laptop par cancel hai aur dusre par nahi - is laptop wala rakha.");
        continue;
      }
      if (billRank(b) > billRank(mine)) {
        bills[i] = b;
        summary.billsUpdated++;
        changed = true;
      } else if (billRank(b) === billRank(mine) && mine.status === "paid" && b.status === "paid") {
        if (mine.amountCash !== b.amountCash || mine.amountUpi !== b.amountUpi || mine.amountDue !== b.amountDue) {
          note("Ek bill dono laptop par alag-alag tareeke se paid hai - is laptop wala rakha.");
        }
      }
    }
    for (const b of list<Bill>(billsIn, "deletedBills")) {
      if (deletedIds.has(b.id)) continue;
      if (at.has(b.id)) {
        note("Ek bill dusre laptop par delete hua hai par yahan chal raha hai - yahan wala rakha.");
        continue;
      }
      deleted.push(b.customerId && alias.has(b.customerId) ? { ...b, customerId: mapCustomer(b.customerId) } : b);
      deletedIds.add(b.id);
      summary.deletedBillsAdded++;
      changed = true;
    }
    if (changed) merged["cuebill-bills"] = JSON.stringify({ ...doc, state: { ...doc.state, bills, deletedBills: deleted } });
  }

  // ---------------- orders ----------------
  const ordersLocal = readDoc(local, "cuebill-orders");
  const ordersIn = readDoc(incoming, "cuebill-orders");
  if (ordersIn) {
    const doc: Doc = ordersLocal ?? { state: { orders: [] }, version: ordersIn.version };
    const orders = [...list<CanteenOrder>(doc, "orders")];
    const at = new Map(orders.map((o, i) => [o.id, i]));
    let changed = false;
    for (const raw of list<CanteenOrder>(ordersIn, "orders")) {
      const o = raw.customerId && alias.has(raw.customerId) ? { ...raw, customerId: mapCustomer(raw.customerId) } : raw;
      const i = at.get(o.id);
      if (i === undefined) {
        orders.push(o);
        at.set(o.id, orders.length - 1);
        summary.ordersAdded++;
        changed = true;
      } else if (orderRank(o) > orderRank(orders[i])) {
        orders[i] = { ...orders[i], status: o.status };
        summary.ordersUpdated++;
        changed = true;
      }
    }
    if (changed) merged["cuebill-orders"] = JSON.stringify({ ...doc, state: { ...doc.state, orders } });
  }

  // ---------------- expenses ----------------
  const expLocal = readDoc(local, "cuebill-expenses");
  const expIn = readDoc(incoming, "cuebill-expenses");
  if (expIn) {
    const doc: Doc = expLocal ?? { state: { expenses: [], categories: [] }, version: expIn.version };
    const expenses = [...list<{ id: string }>(doc, "expenses")];
    const ids = new Set(expenses.map((e) => e.id));
    const categories = [...list<string>(doc, "categories")];
    let changed = false;
    for (const e of list<{ id: string }>(expIn, "expenses")) {
      if (ids.has(e.id)) continue;
      expenses.push(e);
      ids.add(e.id);
      summary.expensesAdded++;
      changed = true;
    }
    for (const c of list<string>(expIn, "categories")) {
      if (!categories.includes(c)) {
        categories.push(c);
        changed = true;
      }
    }
    if (changed) merged["cuebill-expenses"] = JSON.stringify({ ...doc, state: { ...doc.state, expenses, categories } });
  }

  // ---------------- menu, tables, games: only what is missing ----------------
  const menuLocal = readDoc(local, "cuebill-menu");
  const menuIn = readDoc(incoming, "cuebill-menu");
  if (menuIn) {
    const doc: Doc = menuLocal ?? { state: { categories: [], items: [], pendingStockDeltas: {} }, version: menuIn.version };
    const categories = [...list<{ id: string }>(doc, "categories")];
    const items = [...list<{ id: string }>(doc, "items")];
    const catIds = new Set(categories.map((c) => c.id));
    const itemIds = new Set(items.map((i) => i.id));
    let changed = false;
    for (const c of list<{ id: string }>(menuIn, "categories")) {
      if (!catIds.has(c.id)) {
        categories.push(c);
        catIds.add(c.id);
        changed = true;
      }
    }
    for (const i of list<{ id: string }>(menuIn, "items")) {
      if (!itemIds.has(i.id)) {
        items.push(i);
        itemIds.add(i.id);
        summary.menuItemsAdded++;
        changed = true;
      }
    }
    if (changed) merged["cuebill-menu"] = JSON.stringify({ ...doc, state: { ...doc.state, categories, items } });
  }
  const tablesLocal = readDoc(local, "cuebill-tables");
  const tablesIn = readDoc(incoming, "cuebill-tables");
  if (tablesIn) {
    const doc: Doc = tablesLocal ?? { state: { tables: [], pendingPatches: {} }, version: tablesIn.version };
    const tables = [...list<Record<string, unknown> & { id: string }>(doc, "tables")];
    const ids = new Set(tables.map((t) => t.id));
    let changed = false;
    for (const t of list<Record<string, unknown> & { id: string }>(tablesIn, "tables")) {
      if (ids.has(t.id)) continue;
      // a table of the other laptop starts here as free - its running session is theirs
      tables.push({ ...t, status: "available", customerId: null, extraCustomerIds: [], activeGameId: null, sessionRatePerHour: null, sessionStartedAt: null, accumulatedMs: 0, plannedDurationMs: null });
      ids.add(t.id);
      summary.tablesAdded++;
      changed = true;
    }
    if (changed) merged["cuebill-tables"] = JSON.stringify({ ...doc, state: { ...doc.state, tables } });
  }
  const gamesLocal = readDoc(local, "cuebill-games");
  const gamesIn = readDoc(incoming, "cuebill-games");
  if (gamesIn) {
    const doc: Doc = gamesLocal ?? { state: { games: [] }, version: gamesIn.version };
    const games = [...list<{ id: string }>(doc, "games")];
    const ids = new Set(games.map((g) => g.id));
    let changed = false;
    for (const g of list<{ id: string }>(gamesIn, "games")) {
      if (ids.has(g.id)) continue;
      games.push(g);
      ids.add(g.id);
      summary.gamesAdded++;
      changed = true;
    }
    if (changed) merged["cuebill-games"] = JSON.stringify({ ...doc, state: { ...doc.state, games } });
  }

  return { merged, summary };
}
