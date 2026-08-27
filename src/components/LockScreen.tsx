import { useState, type ReactNode } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { Lock } from "lucide-react";

// Gates the whole app behind a shared password on this device. Once
// unlocked, it stays unlocked (see useAuthStore) until someone locks it again
// from Settings — meant for a counter device that stays open all day, not a
// per-visit login.
export function LockScreen({ children }: { children: ReactNode }) {
  const unlocked = useAuthStore((s) => s.unlocked);
  const unlock = useAuthStore((s) => s.unlock);
  const appPassword = useSettingsStore((s) => s.appPassword);
  const storeName = useSettingsStore((s) => s.storeName);

  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  if (unlocked) return <>{children}</>;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === appPassword) {
      setError("");
      unlock();
    } else {
      setError("Wrong password");
      setInput("");
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-[var(--color-primary)]/15 text-[var(--color-primary)] flex items-center justify-center">
          <Lock size={24} />
        </div>
        <div>
          <p className="text-lg font-semibold">{storeName}</p>
          <p className="text-sm text-[var(--color-text-dim)]">Enter password to continue</p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError("");
          }}
          placeholder="Password"
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 py-3 text-center text-lg tracking-widest outline-none focus:border-[var(--color-primary)]"
        />
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        <button
          type="submit"
          disabled={!input}
          className="w-full rounded-xl bg-[var(--color-primary)] disabled:opacity-40 text-white font-semibold py-3"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
