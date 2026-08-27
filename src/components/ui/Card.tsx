import type { ReactNode } from "react";
import clsx from "clsx";

export function Card({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4",
        onClick && "cursor-pointer active:scale-[0.99] transition-transform",
        className
      )}
    >
      {children}
    </div>
  );
}
