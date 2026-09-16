import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StoreSettings } from "../types";
import { supabase } from "../lib/supabaseClient";
import { pushUpsert } from "../lib/cloudSync";

interface SettingsRow {
  id: number;
  store_name: string;
  currency_symbol: string;
  timezone: string;
  upi_id: string;
  app_password: string;
  // Optional: only present once supabase/migration-admin-pin.sql has been
  // run. Missing (not just null) on any row fetched before that.
  admin_pin?: string;
  theme_color: string;
  theme_mode: string;
}

const TABLE = "store_settings";
const fromRow = (row: SettingsRow): StoreSettings => ({
  storeName: row.store_name,
  currencySymbol: row.currency_symbol,
  timezone: row.timezone,
  upiId: row.upi_id,
  appPassword: row.app_password,
  adminPin: row.admin_pin ?? "0000",
  themeColor: row.theme_color,
  themeMode: row.theme_mode as StoreSettings["themeMode"],
});
const toRow = (s: StoreSettings): SettingsRow => ({
  id: 1,
  store_name: s.storeName,
  currency_symbol: s.currencySymbol,
  timezone: s.timezone,
  upi_id: s.upiId,
  app_password: s.appPassword,
  admin_pin: s.adminPin,
  theme_color: s.themeColor,
  theme_mode: s.themeMode,
});

interface SettingsState extends StoreSettings {
  update: (patch: Partial<StoreSettings>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      storeName: "My Game Zone",
      currencySymbol: "₹",
      timezone: "Asia/Kolkata",
      upiId: "",
      appPassword: "0000",
      adminPin: "0000",
      themeColor: "#8b5cf6",
      themeMode: "dark",
      update: (patch) => {
        set((state) => ({ ...state, ...patch }));
        if (supabase) {
          const { update: _update, ...rest } = get();
          void _update;
          pushUpsert(TABLE, toRow(rest as StoreSettings));
        }
      },
    }),
    {
      name: "cuebill-settings",
      version: 5,
      migrate: (persisted) => ({
        upiId: "",
        appPassword: "0000",
        adminPin: "0000",
        themeColor: "#8b5cf6",
        themeMode: "dark",
        ...(persisted as object),
      }),
    }
  )
);

// adminPin is only readable from the cloud once
// supabase/migration-admin-pin.sql has been run — until then a fetch always
// comes back with the column missing, and fromRow's "0000" fallback would
// silently reset a PIN this device already changed. Keep the local value
// instead of letting a stale/columnless fetch overwrite it.
function keepLocalAdminPin(incoming: StoreSettings, local: StoreSettings): StoreSettings {
  return incoming.adminPin === "0000" && local.adminPin !== "0000"
    ? { ...incoming, adminPin: local.adminPin }
    : incoming;
}

// Single-row table (id 1) — a bit of custom wiring since the shared
// setupSync helper is built for lists, not one object.
if (supabase) {
  supabase
    .from(TABLE)
    .select("*")
    .eq("id", 1)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        console.error(`[cloudSync] initial fetch of "${TABLE}" failed`, error);
        return;
      }
      if (data) {
        useSettingsStore.setState(keepLocalAdminPin(fromRow(data as SettingsRow), useSettingsStore.getState()));
      } else {
        // Nothing in the cloud yet — this device's settings become the seed.
        const { update: _update, ...rest } = useSettingsStore.getState();
        void _update;
        pushUpsert(TABLE, toRow(rest as StoreSettings));
      }
    });

  supabase
    .channel(`${TABLE}-sync`)
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, (payload) => {
      if (payload.eventType === "DELETE") return; // the single row never gets deleted
      useSettingsStore.setState(
        keepLocalAdminPin(fromRow(payload.new as SettingsRow), useSettingsStore.getState())
      );
    })
    .subscribe();
}
