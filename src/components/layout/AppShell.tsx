import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="mx-auto max-w-md pb-28">
        <TopBar title={title} />
        <main className="px-4 space-y-4">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
