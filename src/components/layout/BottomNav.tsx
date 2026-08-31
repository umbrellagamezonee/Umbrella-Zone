import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { navItems } from "./navItems";

// Phone-only — tablet landscape and desktop get SideNav instead.
export function BottomNav() {
  return (
    <nav className="md:hidden fixed bottom-3 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-md">
      <div className="flex items-center justify-between rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur px-2 py-2 shadow-lg shadow-black/40">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              clsx(
                "flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl text-[10px] font-medium min-w-[3rem]",
                isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-faint)]"
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={20} strokeWidth={isActive ? 2.4 : 1.8} />
                <span className="truncate max-w-[3rem]">{label}</span>
                {isActive && (
                  <span className="h-0.5 w-4 rounded-full bg-[var(--color-primary)] mt-0.5" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
