import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Cloud sync is entirely optional — without these two env vars the app just
// runs local-only (localStorage), exactly as it always has. Set them (in
// .env.local for dev, or the host's env var settings for prod) to turn on
// multi-device sync.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const isCloudSyncEnabled = !!supabase;
