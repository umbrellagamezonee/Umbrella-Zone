import { useSettingsStore } from "../../store/useSettingsStore";

export function TopBar({ title }: { title: string }) {
  const storeName = useSettingsStore((s) => s.storeName);
  const initial = storeName.trim().charAt(0).toUpperCase() || "S";

  return (
    <header className="flex items-center justify-between px-4 pt-4 pb-3">
      <div className="h-9 w-9 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center font-semibold">
        {initial}
      </div>
      <h1 className="text-base font-semibold">{title}</h1>
      <div className="h-9 w-9" />
    </header>
  );
}
