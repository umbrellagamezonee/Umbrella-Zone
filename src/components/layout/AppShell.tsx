import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { SideNav } from "./SideNav";

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <SideNav />
      <div className="md:ml-56">
        <div className="mx-auto max-w-md md:max-w-2xl pb-28 md:pb-12">
          <TopBar title={title} />
          <main className="px-4 space-y-4">{children}</main>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
