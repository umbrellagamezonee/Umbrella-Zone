import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MenuCategory, MenuItem } from "../types";
import { setupSync, pushInsert, pushUpsert, pushDelete, pushDeleteAll } from "../lib/cloudSync";

const seedCategories: MenuCategory[] = [
  { id: "cat-sandwiches", name: "Sandwiches & Kulcha" },
  { id: "cat-maggi-eggs", name: "Maggi & Eggs" },
  { id: "cat-chinese-fries", name: "Chinese & Fries" },
  { id: "cat-drinks", name: "Drinks" },
];

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
  // Sandwiches & Kulcha
  item("Veg Grilled Sandwich (with Amul Butter)", "cat-sandwiches", 35),
  item("Pasta Sandwich (with Amul Butter)", "cat-sandwiches", 40),
  item("Veg Kulcha (with Amul Butter)", "cat-sandwiches", 40),
  item("Veg Burger (with Amul Butter)", "cat-sandwiches", 40),
  item("Sweetcorn Patties (with Amul Butter)", "cat-sandwiches", 25),
  item("Spl. Veg Sandwich", "cat-sandwiches", 80),

  // Maggi & Eggs
  item("Veg Maggi", "cat-maggi-eggs", 40),
  item("Paneer Maggi", "cat-maggi-eggs", 60),
  item("Egg Maggi", "cat-maggi-eggs", 50),
  item("Double Masala Maggi", "cat-maggi-eggs", 50),
  item("Egg Omelette (2 Egg)", "cat-maggi-eggs", 50),
  item("Egg Fry", "cat-maggi-eggs", 30),
  item("Egg Bhurji", "cat-maggi-eggs", 50),
  item("Half Fry", "cat-maggi-eggs", 30),
  item("Egg Pizza", "cat-maggi-eggs", 150),

  // Chinese & Fries
  item("Veg Noodles", "cat-chinese-fries", 80),
  item("Paneer Noodles", "cat-chinese-fries", 100),
  item("French Fries", "cat-chinese-fries", 70),
  item("Peri-Peri Fries", "cat-chinese-fries", 80),
  item("Chilli Potato", "cat-chinese-fries", 110),
  item("Cheese Chilli", "cat-chinese-fries", 150),
  item("Dry Manchurian", "cat-chinese-fries", 110),
  item("Gravy Manchurian", "cat-chinese-fries", 130),
  item("Spring Roll", "cat-chinese-fries", 80),
  item("Fry Momos", "cat-chinese-fries", 70),
  item("Chilli Mushroom", "cat-chinese-fries", 110),

  // Drinks
  item("Cold Coffee", "cat-drinks", 60),
  item("Hot Coffee", "cat-drinks", 20),
  item("Tea", "cat-drinks", 20),
  item("Chocolate Shake", "cat-drinks", 80),
  item("Kitkat Shake", "cat-drinks", 90),
  item("Oreo Shake", "cat-drinks", 90),
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
  stockQty: row.stock_qty,
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
  addCategory: (name: string) => void;
  removeCategory: (id: string) => void;
  addItem: (item: Omit<MenuItem, "id">) => void;
  updateItem: (id: string, patch: Partial<MenuItem>) => void;
  removeItem: (id: string) => void;
  deductStock: (id: string, qty: number) => void;
  restock: (id: string, qty: number) => void;
  resetAll: () => void;
}

export const useMenuStore = create<MenuState>()(
  persist(
    (set, get) => ({
      categories: seedCategories,
      items: seedItems,

      addCategory: (name) => {
        const created: MenuCategory = { id: crypto.randomUUID(), name };
        set((state) => ({ categories: [...state.categories, created] }));
        pushInsert(CAT_TABLE, catToRow(created));
      },

      removeCategory: (id) => {
        set((state) => ({ categories: state.categories.filter((c) => c.id !== id) }));
        pushDelete(CAT_TABLE, id);
      },

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

      deductStock: (id, qty) => {
        set((state) => ({
          items: state.items.map((i) =>
            i.id === id && i.stockQty != null
              ? { ...i, stockQty: Math.max(0, i.stockQty - qty) }
              : i
          ),
        }));
        const updated = get().items.find((i) => i.id === id);
        if (updated) pushUpsert(ITEM_TABLE, itemToRow(updated));
      },

      restock: (id, qty) => {
        set((state) => ({
          items: state.items.map((i) =>
            i.id === id && i.stockQty != null ? { ...i, stockQty: i.stockQty + qty } : i
          ),
        }));
        const updated = get().items.find((i) => i.id === id);
        if (updated) pushUpsert(ITEM_TABLE, itemToRow(updated));
      },

      resetAll: () => {
        set({ categories: [], items: [] });
        pushDeleteAll(CAT_TABLE);
        pushDeleteAll(ITEM_TABLE);
      },
    }),
    {
      name: "cuebill-menu",
      // Bumped to reset everyone onto the real cafe menu — this intentionally
      // replaces old placeholder items/categories rather than merging them.
      version: 2,
      migrate: () => ({ categories: seedCategories, items: seedItems }),
    }
  )
);

setupSync<CategoryRow, MenuCategory>(
  CAT_TABLE,
  catFromRow,
  catToRow,
  () => useMenuStore.getState().categories,
  (categories) => useMenuStore.setState({ categories }),
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
  (items) =>
    useMenuStore.setState((state) => {
      const byId = new Map(state.items.map((i) => [i.id, i]));
      return { items: items.map((i) => keepLocalCostPrice(i, byId.get(i.id))) };
    }),
  (item) =>
    useMenuStore.setState((state) => {
      const existing = state.items.find((i) => i.id === item.id);
      const merged = keepLocalCostPrice(item, existing);
      return {
        items: existing ? state.items.map((i) => (i.id === item.id ? merged : i)) : [...state.items, merged],
      };
    }),
  (id) => useMenuStore.setState((state) => ({ items: state.items.filter((i) => i.id !== id) }))
);
