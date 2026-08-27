import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Game } from "../types";

const seedGames: Game[] = [
  { id: crypto.randomUUID(), name: "FIFA / EA FC", kind: "PlayStation", ratePerHour: 60 },
  { id: crypto.randomUUID(), name: "GTA V", kind: "PlayStation", ratePerHour: 80 },
  { id: crypto.randomUUID(), name: "Racing (GT7 / Forza)", kind: "PlayStation", ratePerHour: 100 },
  { id: crypto.randomUUID(), name: "Call of Duty", kind: "PlayStation", ratePerHour: 90 },
];

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

      addGame: (game) =>
        set((state) => ({ games: [...state.games, { ...game, id: crypto.randomUUID() }] })),

      updateGame: (id, patch) =>
        set((state) => ({
          games: state.games.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        })),

      removeGame: (id) =>
        set((state) => ({ games: state.games.filter((g) => g.id !== id) })),

      kinds: () => Array.from(new Set(get().games.map((g) => g.kind))),
    }),
    { name: "cuebill-games" }
  )
);
