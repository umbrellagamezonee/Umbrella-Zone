import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { navItems } from "./navItems";
import { useSettingsStore } from "../../store/useSettingsStore";

// Tablet landscape and desktop only (md: and up) — phones get BottomNav.
export function SideNav() {
  const storeName = useSettingsStore((s) => s.storeName);

  return (
    <nav className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-56 md:shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-5">
      <div className="flex items-center gap-2.5 px-2 pb-6">
        <div className="h-8 w-8 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center font-semibold text-sm shrink-0">
          {storeName.trim().charAt(0).toUpperCase() || "S"}
        </div>
        <span className="font-semibold truncate">{storeName || "CueBill"}</span>
      </div>

      <div className="flex flex-col gap-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
              )
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
