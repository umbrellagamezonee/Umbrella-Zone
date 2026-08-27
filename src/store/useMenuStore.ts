import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MenuCategory, MenuItem } from "../types";

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
}

export const useMenuStore = create<MenuState>()(
  persist(
    (set) => ({
      categories: seedCategories,
      items: seedItems,

      addCategory: (name) =>
        set((state) => ({
          categories: [...state.categories, { id: crypto.randomUUID(), name }],
        })),

      removeCategory: (id) =>
        set((state) => ({ categories: state.categories.filter((c) => c.id !== id) })),

      addItem: (item) =>
        set((state) => ({ items: [...state.items, { ...item, id: crypto.randomUUID() }] })),

      updateItem: (id, patch) =>
        set((state) => ({
          items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
        })),

      removeItem: (id) =>
        set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

      deductStock: (id, qty) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.id === id && i.stockQty != null
              ? { ...i, stockQty: Math.max(0, i.stockQty - qty) }
              : i
          ),
        })),

      restock: (id, qty) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.id === id && i.stockQty != null ? { ...i, stockQty: i.stockQty + qty } : i
          ),
        })),
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
