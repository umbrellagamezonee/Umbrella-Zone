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
      update: (patch) => set((state) => ({ ...state, ...patch })),
    }),
    {
      name: "cuebill-settings",
      version: 2,
      migrate: (persisted) => ({ upiId: "", appPassword: "0000", ...(persisted as object) }),
    }
  )
);
