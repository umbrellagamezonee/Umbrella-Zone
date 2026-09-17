import { useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "./ui/Modal";
import { useSettingsStore } from "../store/useSettingsStore";
import { Lock } from "lucide-react";

interface Props {
  title: string;
  onClose: () => void;
  // Whole-screen gate (Menu Management, Deleted Bills, ...): render children
  // once the PIN is entered correctly.
  children?: ReactNode;
  // One-off action confirm (deleting a table, a canteen order, ...): call
  // this once the PIN is entered correctly, then close.
  onConfirm?: () => void;
}

// Second PIN check in front of anything an owner doesn't want staff undoing
// just because they know the shared app password (needed only to open the
// app at all). Set/changed from Settings → Backup & Restore. Doesn't persist
// "unlocked" — asks fresh every time.
export function AdminPinGate({ title, onClose, children, onConfirm }: Props) {
  const adminPin = useSettingsStore((s) => s.adminPin);
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  if (unlocked && children) return <>{children}</>;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (input !== adminPin) {
      setError("Wrong PIN");
      setInput("");
      return;
    }
    if (onConfirm) {
      onConfirm();
      onClose();
    } else {
      setUnlocked(true);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4 py-2 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-[var(--color-primary)]/15 text-[var(--color-primary)] flex items-center justify-center">
          <Lock size={24} />
        </div>
        <p className="text-sm text-[var(--color-text-dim)]">
          {onConfirm ? "Admin PIN required to confirm this." : "Admin PIN required to open this."}
        </p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError("");
          }}
          placeholder="Admin PIN"
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 py-3 text-center text-lg tracking-widest outline-none focus:border-[var(--color-primary)]"
        />
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        <button
          type="submit"
          disabled={!input}
          className={
            "w-full rounded-xl disabled:opacity-40 text-white font-semibold py-3 " +
            (onConfirm ? "bg-[var(--color-danger)]" : "bg-[var(--color-primary)]")
          }
        >
          {onConfirm ? "Confirm delete" : "Unlock"}
        </button>
      </form>
    </Modal>
  );
}
