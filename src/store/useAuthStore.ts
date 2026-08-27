import { create } from "zustand";
import { persist } from "zustand/middleware";

// Whether this device has been unlocked with the shared app password. This is
// a light deterrent against casual/public access once the app is live on the
// internet — not real security (the check happens in the browser, so anyone
// who opens devtools can bypass it). Don't rely on it to protect anything
// beyond keeping randoms from poking around the counter screen.
interface AuthState {
  unlocked: boolean;
  unlock: () => void;
  lock: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      unlocked: false,
      unlock: () => set({ unlocked: true }),
      lock: () => set({ unlocked: false }),
    }),
    { name: "cuebill-auth", version: 1 }
  )
);
