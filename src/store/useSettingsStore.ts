import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StoreSettings } from "../types";

interface SettingsState extends StoreSettings {
  update: (patch: Partial<StoreSettings>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      storeName: "My Game Zone",
      currencySymbol: "₹",
      timezone: "Asia/Kolkata",
      upiId: "",
      appPassword: "0000",
      themeColor: "#8b5cf6",
      themeMode: "dark",
      update: (patch) => set((state) => ({ ...state, ...patch })),
    }),
    {
      name: "cuebill-settings",
      version: 4,
      migrate: (persisted) => ({
        upiId: "",
        appPassword: "0000",
        themeColor: "#8b5cf6",
        themeMode: "dark",
        ...(persisted as object),
      }),
    }
  )
);
