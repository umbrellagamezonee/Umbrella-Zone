import { useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { TableCard } from "../components/TableCard";
import { StartSessionModal } from "../components/StartSessionModal";
import { useTablesStore } from "../store/useTablesStore";
import { useNow } from "../lib/useNow";

export function Home() {
  const tables = useTablesStore((s) => s.tables);
  const now = useNow();
  const [startTableId, setStartTableId] = useState<string | null>(null);

  const startTable = tables.find((t) => t.id === startTableId) || null;
  // Home is just for starting a fresh session — once a table is running/paused,
  // it's managed from the Sessions page instead of cluttering this list.
  // Collection stats and floor status live on Reports instead.
  const availableTables = tables.filter((t) => t.status === "available");

  return (
    <AppShell title="Home">
      <div>
        <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
          TABLES
        </p>
        <div className="space-y-3">
          {availableTables.map((table) => (
            <TableCard
              key={table.id}
              table={table}
              now={now}
              onOpenDetail={() => {}}
              onStart={(t) => setStartTableId(t.id)}
            />
          ))}
          {tables.length === 0 && (
            <p className="text-center text-sm text-[var(--color-text-faint)] py-6">
              No tables yet — add some in Settings → Table Management.
            </p>
          )}
          {tables.length > 0 && availableTables.length === 0 && (
            <p className="text-center text-sm text-[var(--color-text-faint)] py-6">
              Every table's in use — check Sessions to manage them.
            </p>
          )}
        </div>
      </div>

      {startTable && (
        <StartSessionModal table={startTable} onClose={() => setStartTableId(null)} />
      )}
    </AppShell>
  );
}
