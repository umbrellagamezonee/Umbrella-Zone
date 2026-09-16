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

// Falls back to this when a fetch's row doesn't have the admin_pin column
// yet (migration not run) — not just an arbitrary default.
const DEFAULT_ADMIN_PIN = "0310";

const TABLE = "store_settings";
const fromRow = (row: SettingsRow): StoreSettings => ({
  storeName: row.store_name,
  currencySymbol: row.currency_symbol,
  timezone: row.timezone,
  upiId: row.upi_id,
  appPassword: row.app_password,
  adminPin: row.admin_pin ?? DEFAULT_ADMIN_PIN,
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
      adminPin: DEFAULT_ADMIN_PIN,
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
      version: 6,
      migrate: (persisted, version) => {
        const state = { upiId: "", appPassword: "0000", themeColor: "#8b5cf6", themeMode: "dark", ...(persisted as object) } as StoreSettings;
        // Anyone still on the old hardcoded "0000" default (persisted before
        // this version, or never explicitly changed) picks up the new one —
        // an actual custom PIN someone already set is left alone.
        if (version < 6 && (!("adminPin" in state) || state.adminPin === "0000")) {
          state.adminPin = DEFAULT_ADMIN_PIN;
        }
        return state;
      },
    }
  )
);

// adminPin is only readable from the cloud once
// supabase/migration-admin-pin.sql has been run — until then a fetch's row
// simply doesn't have the column (not null — absent), and fromRow's default
// fallback would silently reset a PIN this device already changed. Keep the
// local value in that case instead of letting a stale/columnless fetch
// overwrite it; this checks the raw row, not the resolved value, so it
// isn't tied to whatever the current default PIN happens to be.
function keepLocalAdminPin(row: SettingsRow, incoming: StoreSettings, local: StoreSettings): StoreSettings {
  return row.admin_pin === undefined ? { ...incoming, adminPin: local.adminPin } : incoming;
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
        const row = data as SettingsRow;
        useSettingsStore.setState(keepLocalAdminPin(row, fromRow(row), useSettingsStore.getState()));
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
      const row = payload.new as SettingsRow;
      useSettingsStore.setState(keepLocalAdminPin(row, fromRow(row), useSettingsStore.getState()));
    })
    .subscribe();
}
