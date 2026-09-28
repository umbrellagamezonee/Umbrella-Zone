import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MenuCategory, MenuItem } from "../types";
import {
  setupSync,
  pushInsert,
  pushUpsert,
  pushIncrement,
  pushDelete,
  pushDeleteAll,
  keepLocalOnly,
} from "../lib/cloudSync";

// The shop only wants exactly these three, fixed — no more freeform add/
// remove of categories. Ids are stable strings (not random) so every device
// converges on the same three rows instead of creating its own duplicates.
const seedCategories: MenuCategory[] = [
  { id: "cat-kitchen", name: "Kitchen" },
  { id: "cat-cigarettes", name: "Cigarettes" },
  { id: "cat-fridge", name: "Fridge" },
  { id: "cat-chocolate", name: "Chocolate" },
];

// Old freeform categories being folded into the fixed set below — anything
// under an unrecognized/removed category id falls back to Kitchen.
const CATEGORY_REMAP: Record<string, string> = {
  "cat-sandwiches": "cat-kitchen",
  "cat-maggi-eggs": "cat-kitchen",
  "cat-chinese-fries": "cat-kitchen",
  "cat-drinks": "cat-fridge",
};

function item(name: string, categoryId: string, price: number): MenuItem {
  return {
    id: crypto.randomUUID(),
    name,
    categoryId,
    price,
    costPrice: null,
    inStock: true,
    stockQty: null,
    lowStockThreshold: 5,
  };
}

const seedItems: MenuItem[] = [
  // Kitchen
  item("Veg Grilled Sandwich (with Amul Butter)", "cat-kitchen", 35),
  item("Pasta Sandwich (with Amul Butter)", "cat-kitchen", 40),
  item("Veg Kulcha (with Amul Butter)", "cat-kitchen", 40),
  item("Veg Burger (with Amul Butter)", "cat-kitchen", 40),
  item("Sweetcorn Patties (with Amul Butter)", "cat-kitchen", 25),
  item("Spl. Veg Sandwich", "cat-kitchen", 80),
  item("Veg Maggi", "cat-kitchen", 40),
  item("Paneer Maggi", "cat-kitchen", 60),
  item("Egg Maggi", "cat-kitchen", 50),
  item("Double Masala Maggi", "cat-kitchen", 50),
  item("Egg Omelette (2 Egg)", "cat-kitchen", 50),
  item("Egg Fry", "cat-kitchen", 30),
  item("Egg Bhurji", "cat-kitchen", 50),
  item("Half Fry", "cat-kitchen", 30),
  item("Egg Pizza", "cat-kitchen", 150),
  item("Veg Noodles", "cat-kitchen", 80),
  item("Paneer Noodles", "cat-kitchen", 100),
  item("French Fries", "cat-kitchen", 70),
  item("Peri-Peri Fries", "cat-kitchen", 80),
  item("Chilli Potato", "cat-kitchen", 110),
  item("Cheese Chilli", "cat-kitchen", 150),
  item("Dry Manchurian", "cat-kitchen", 110),
  item("Gravy Manchurian", "cat-kitchen", 130),
  item("Spring Roll", "cat-kitchen", 80),
  item("Fry Momos", "cat-kitchen", 70),
  item("Chilli Mushroom", "cat-kitchen", 110),

  // Fridge
  item("Cold Coffee", "cat-fridge", 60),
  item("Hot Coffee", "cat-fridge", 20),
  item("Tea", "cat-fridge", 20),
  item("Chocolate Shake", "cat-fridge", 80),
  item("Kitkat Shake", "cat-fridge", 90),
  item("Oreo Shake", "cat-fridge", 90),
];

interface CategoryRow {
  id: string;
  name: string;
}
interface ItemRow {
  id: string;
  name: string;
  category_id: string;
  price: number;
  cost_price: number | null;
  in_stock: boolean;
  stock_qty: number | null;
  low_stock_threshold: number;
}

const CAT_TABLE = "menu_categories";
const ITEM_TABLE = "menu_items";
const catFromRow = (row: CategoryRow): MenuCategory => ({ id: row.id, name: row.name });
const catToRow = (c: MenuCategory): CategoryRow => ({ id: c.id, name: c.name });
const itemFromRow = (row: ItemRow): MenuItem => ({
  id: row.id,
  name: row.name,
  categoryId: row.category_id,
  price: Number(row.price),
  costPrice: row.cost_price != null ? Number(row.cost_price) : null,
  inStock: row.in_stock,
  // Defensive floor — a row written before increment_stock_qty's own floor
  // existed (two devices selling the last unit at once) could still hold a
  // negative count; never show that as if less-than-zero stock were real.
  stockQty: row.stock_qty != null ? Math.max(0, row.stock_qty) : null,
  lowStockThreshold: row.low_stock_threshold,
});
const itemToRow = (i: MenuItem): ItemRow => ({
  id: i.id,
  name: i.name,
  category_id: i.categoryId,
  price: i.price,
  cost_price: i.costPrice,
  in_stock: i.inStock,
  stock_qty: i.stockQty,
  low_stock_threshold: i.lowStockThreshold,
});

interface MenuState {
  categories: MenuCategory[];
  items: MenuItem[];
  // Stock changes made locally but not yet confirmed saved to the cloud —
  // the common cause is the network dropping for a moment right when
  // someone adds an item to an order. Kept in persisted state (not just
  // memory) so a page reload before the connection recovers doesn't lose
  // track of what still needs sending — see sendStockDelta/
  // flushPendingStockDeltas below, keyed by menu item id.
  pendingStockDeltas: Record<string, number>;
  addItem: (item: Omit<MenuItem, "id">) => void;
  updateItem: (id: string, patch: Partial<MenuItem>) => void;
  removeItem: (id: string) => void;
  deductStock: (id: string, qty: number) => void;
  restock: (id: string, qty: number) => void;
  resetAll: () => void;
}

export const useMenuStore = create<MenuState>()(
  persist(
    (set, get) => {
      // Shared by deductStock/restock — applies the change locally right
      // away (so the person ordering sees it instantly) and queues it to be
      // sent to the cloud, retried until it actually lands rather than
      // assumed sent the moment the request goes out.
      const applyStockDelta = (id: string, delta: number) => {
        const before = get().items.find((i) => i.id === id);
        if (!before || before.stockQty == null) return;
        set((state) => ({
          items: state.items.map((i) =>
            i.id === id && i.stockQty != null ? { ...i, stockQty: Math.max(0, i.stockQty + delta) } : i
          ),
          pendingStockDeltas: {
            ...state.pendingStockDeltas,
            [id]: (state.pendingStockDeltas[id] ?? 0) + delta,
          },
        }));
        sendStockDelta(id);
      };

      return {
        categories: seedCategories,
        items: seedItems,
        pendingStockDeltas: {},

        addItem: (item) => {
          const created: MenuItem = { ...item, id: crypto.randomUUID() };
          set((state) => ({ items: [...state.items, created] }));
          pushInsert(ITEM_TABLE, itemToRow(created));
        },

        updateItem: (id, patch) => {
          set((state) => ({
            items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
          }));
          const updated = get().items.find((i) => i.id === id);
          if (updated) pushUpsert(ITEM_TABLE, itemToRow(updated));
        },

        removeItem: (id) => {
          set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
          pushDelete(ITEM_TABLE, id);
        },

        // Atomic "-= qty" on the server, via increment_stock_qty — several
        // orders for the same item within the same second (busy canteen)
        // can't lose a deduction to the network delivering requests out of
        // order.
        deductStock: (id, qty) => applyStockDelta(id, -qty),
        restock: (id, qty) => applyStockDelta(id, qty),

        resetAll: () => {
          set({ categories: [], items: [], pendingStockDeltas: {} });
          pushDeleteAll(CAT_TABLE);
          pushDeleteAll(ITEM_TABLE);
        },
      };
    },
    {
      name: "cuebill-menu",
      // v3: collapsed the old freeform categories down to the fixed
      // Kitchen/Cigarettes/Fridge set — remap existing items instead of
      // wiping them like the v2 reset did.
      version: 3,
      migrate: (persisted, version) => {
        if (version < 2) return { categories: seedCategories, items: seedItems };
        const state = persisted as { categories?: MenuCategory[]; items?: MenuItem[] };
        const items = (state.items ?? []).map((i) =>
          CATEGORY_REMAP[i.categoryId] ? { ...i, categoryId: CATEGORY_REMAP[i.categoryId] } : i
        );
        return { categories: seedCategories, items };
      },
    }
  )
);

// In-flight guard so a delta already on its way to the server isn't sent
// again by a concurrent flush (e.g. the periodic retry firing while an
// earlier send for the same item is still in the air).
const stockDeltaInFlight = new Set<string>();

// Sends whatever's still queued in pendingStockDeltas for one item.
// Re-reads the queue after the request settles (rather than trusting the
// amount it started with) since more of the same item could have been
// ordered while this was in flight — that gets picked up by one more call
// instead of waiting for the next flush.
function sendStockDelta(id: string) {
  if (stockDeltaInFlight.has(id)) return;
  const pending = useMenuStore.getState().pendingStockDeltas[id];
  if (!pending) return;
  const item = useMenuStore.getState().items.find((i) => i.id === id);
  if (!item) {
    // Item's gone (deleted) — nothing left to reconcile this delta against.
    useMenuStore.setState((state) => {
      const rest = { ...state.pendingStockDeltas };
      delete rest[id];
      return { pendingStockDeltas: rest };
    });
    return;
  }
  stockDeltaInFlight.add(id);
  pushIncrement("increment_stock_qty", { p_id: id, p_delta: pending }, ITEM_TABLE, itemToRow(item)).then((ok) => {
    stockDeltaInFlight.delete(id);
    if (!ok) return;
    useMenuStore.setState((state) => {
      const remaining = (state.pendingStockDeltas[id] ?? 0) - pending;
      const rest = { ...state.pendingStockDeltas };
      if (remaining === 0) delete rest[id];
      else rest[id] = remaining;
      return { pendingStockDeltas: rest };
    });
    if (useMenuStore.getState().pendingStockDeltas[id]) sendStockDelta(id);
  });
}

// Retries every stock change still waiting on a confirmed save to the
// cloud. Called on reconnect, periodically as a safety net for a
// connection that looks "online" but can't actually reach Supabase, and
// once after every fresh sync — so a delta that went unsent (network
// dropped the instant someone tapped "add to order") gets caught and
// resent instead of silently staying wrong until someone notices stock
// doesn't match what's physically left.
function flushPendingStockDeltas() {
  for (const id of Object.keys(useMenuStore.getState().pendingStockDeltas)) sendStockDelta(id);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", flushPendingStockDeltas);
  setInterval(flushPendingStockDeltas, 30_000);
}

// A stock change still waiting on a confirmed save to the cloud (see
// pendingStockDeltas above) hasn't landed in the row this device is about
// to receive here — adding it back on top keeps what's on screen correct
// instead of it flashing back to the pre-deduction number until the retry
// above catches up.
function applyPendingStockDelta(incoming: MenuItem, pending: number | undefined): MenuItem {
  if (!pending || incoming.stockQty == null) return incoming;
  return { ...incoming, stockQty: Math.max(0, incoming.stockQty + pending) };
}

// One-time cleanup for the cloud side of the same category collapse — the
// local `migrate` above only fixes this device's own persisted storage, but
// a fresh cloud fetch would otherwise stomp that with whatever old category
// rows are still sitting in Supabase. Safe to call repeatedly (every device
// runs it after every sync) since it's a no-op once nothing needs remapping,
// and it upserts the three fixed rows (fixed ids) rather than inserting, so
// two devices racing to create them can't collide.
function ensureFixedCategories() {
  const { categories, items } = useMenuStore.getState();
  const fixedIds = new Set(seedCategories.map((c) => c.id));
  const stale = categories.filter((c) => !fixedIds.has(c.id));
  const staleItems = items.filter((i) => !fixedIds.has(i.categoryId));
  if (stale.length === 0 && staleItems.length === 0 && categories.length === seedCategories.length) return;

  const missing = seedCategories.filter((c) => !categories.some((existing) => existing.id === c.id));
  for (const c of missing) pushUpsert(CAT_TABLE, catToRow(c));
  for (const c of stale) pushDelete(CAT_TABLE, c.id);

  const remappedItems = items.map((i) =>
    fixedIds.has(i.categoryId) ? i : { ...i, categoryId: CATEGORY_REMAP[i.categoryId] ?? "cat-kitchen" }
  );
  for (const i of remappedItems) {
    if (i.categoryId !== items.find((x) => x.id === i.id)?.categoryId) pushUpsert(ITEM_TABLE, itemToRow(i));
  }

  useMenuStore.setState({ categories: seedCategories, items: remappedItems });
}

setupSync<CategoryRow, MenuCategory>(
  CAT_TABLE,
  catFromRow,
  catToRow,
  () => useMenuStore.getState().categories,
  (categories) => {
    useMenuStore.setState((state) => ({
      categories: [...categories, ...keepLocalOnly(categories, state.categories)],
    }));
    ensureFixedCategories();
  },
  (cat) =>
    useMenuStore.setState((state) => {
      const exists = state.categories.some((c) => c.id === cat.id);
      return {
        categories: exists
          ? state.categories.map((c) => (c.id === cat.id ? cat : c))
          : [...state.categories, cat],
      };
    }),
  (id) => useMenuStore.setState((state) => ({ categories: state.categories.filter((c) => c.id !== id) }))
);

// Covers the offline/no-Supabase case (setupSync no-ops entirely then) and
// gives the local persisted state one more pass in case items' own cloud
// fetch below lands before this one does.
ensureFixedCategories();

// Cost price is only readable from the cloud once the "cost_price" column
// exists there (see supabase/migration-cost-price.sql). Until then, a fetch
// always comes back with it missing — keep whatever this device already had
// entered instead of letting a stale/columnless fetch silently blank it out.
function keepLocalCostPrice(incoming: MenuItem, local: MenuItem | undefined): MenuItem {
  return incoming.costPrice == null && local?.costPrice != null
    ? { ...incoming, costPrice: local.costPrice }
    : incoming;
}

setupSync<ItemRow, MenuItem>(
  ITEM_TABLE,
  itemFromRow,
  itemToRow,
  () => useMenuStore.getState().items,
  (items) => {
    useMenuStore.setState((state) => {
      const byId = new Map(state.items.map((i) => [i.id, i]));
      const merged = items.map((i) => {
        const withCost = keepLocalCostPrice(i, byId.get(i.id));
        return applyPendingStockDelta(withCost, state.pendingStockDeltas[i.id]);
      });
      // An item added in the gap between this fetch starting and resolving
      // must not vanish — same reasoning as keepLocalOnly's own comment.
      return { items: [...merged, ...keepLocalOnly(items, state.items)] };
    });
    ensureFixedCategories();
    flushPendingStockDeltas();
  },
  (item) =>
    useMenuStore.setState((state) => {
      const existing = state.items.find((i) => i.id === item.id);
      const withCost = keepLocalCostPrice(item, existing);
      const merged = applyPendingStockDelta(withCost, state.pendingStockDeltas[item.id]);
      return {
        items: existing ? state.items.map((i) => (i.id === item.id ? merged : i)) : [...state.items, merged],
      };
    }),
  (id) => useMenuStore.setState((state) => ({ items: state.items.filter((i) => i.id !== id) }))
);
