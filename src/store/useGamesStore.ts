import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Game } from "../types";
import { setupSync, pushInsert, pushUpsert, pushDelete, keepLocalOnly } from "../lib/cloudSync";

const seedGames: Game[] = [
  { id: crypto.randomUUID(), name: "FIFA / EA FC", kind: "PlayStation", ratePerHour: 60 },
  { id: crypto.randomUUID(), name: "GTA V", kind: "PlayStation", ratePerHour: 80 },
  { id: crypto.randomUUID(), name: "Racing (GT7 / Forza)", kind: "PlayStation", ratePerHour: 100 },
  { id: crypto.randomUUID(), name: "Call of Duty", kind: "PlayStation", ratePerHour: 90 },
];

interface GameRow {
  id: string;
  name: string;
  kind: string;
  rate_per_hour: number;
}

const TABLE = "games";
const fromRow = (row: GameRow): Game => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  ratePerHour: Number(row.rate_per_hour),
});
const toRow = (g: Game): GameRow => ({
  id: g.id,
  name: g.name,
  kind: g.kind,
  rate_per_hour: g.ratePerHour,
});

interface GamesState {
  games: Game[];
  addGame: (game: Omit<Game, "id">) => void;
  updateGame: (id: string, patch: Partial<Game>) => void;
  removeGame: (id: string) => void;
  kinds: () => string[];
}

export const useGamesStore = create<GamesState>()(
  persist(
    (set, get) => ({
      games: seedGames,

      addGame: (game) => {
        const created: Game = { ...game, id: crypto.randomUUID() };
        set((state) => ({ games: [...state.games, created] }));
        pushInsert(TABLE, toRow(created));
      },

      updateGame: (id, patch) => {
        set((state) => ({
          games: state.games.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        }));
        const updated = get().games.find((g) => g.id === id);
        if (updated) pushUpsert(TABLE, toRow(updated));
      },

      removeGame: (id) => {
        set((state) => ({ games: state.games.filter((g) => g.id !== id) }));
        pushDelete(TABLE, id);
      },

      kinds: () => Array.from(new Set(get().games.map((g) => g.kind))),
    }),
    { name: "cuebill-games" }
  )
);

setupSync<GameRow, Game>(
  TABLE,
  fromRow,
  toRow,
  () => useGamesStore.getState().games,
  (games) =>
    useGamesStore.setState((state) => ({
      games: [...games, ...keepLocalOnly(games, state.games)],
    })),
  (game) =>
    useGamesStore.setState((state) => {
      const exists = state.games.some((g) => g.id === game.id);
      return {
        games: exists ? state.games.map((g) => (g.id === game.id ? game : g)) : [...state.games, game],
      };
    }),
  (id) => useGamesStore.setState((state) => ({ games: state.games.filter((g) => g.id !== id) }))
);
