// Background/surface/text tokens for each mode. Accent colors (primary,
// success, warning, danger) are handled separately in color.ts / Settings —
// this is just the light/dark half of the theme.
export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
}

export const DARK_PALETTE: Palette = {
  bg: "#0a0612",
  surface: "#150f24",
  surface2: "#1c1430",
  border: "#2a2140",
  text: "#f3f0fa",
  textDim: "#a89fc2",
  textFaint: "#6b6285",
};

export const LIGHT_PALETTE: Palette = {
  bg: "#f7f5fb",
  surface: "#ffffff",
  surface2: "#f1edf9",
  border: "#e1dbee",
  text: "#1d1730",
  textDim: "#5c5470",
  textFaint: "#8c84a3",
};
