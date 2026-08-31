import { useEffect } from "react";
import { useSettingsStore } from "../store/useSettingsStore";
import { themeShades } from "../lib/color";
import { DARK_PALETTE, LIGHT_PALETTE } from "../lib/palette";

// Pushes the chosen theme color and light/dark mode onto :root as CSS
// variables, overriding the dark defaults baked into index.css. Renders
// nothing — just keeps the page in sync whenever Settings changes.
export function ThemeApplier() {
  const themeColor = useSettingsStore((s) => s.themeColor);
  const themeMode = useSettingsStore((s) => s.themeMode);

  useEffect(() => {
    const { primary, primaryDark, accent } = themeShades(themeColor);
    const palette = themeMode === "light" ? LIGHT_PALETTE : DARK_PALETTE;
    const root = document.documentElement.style;
    root.setProperty("--color-primary", primary);
    root.setProperty("--color-primary-dark", primaryDark);
    root.setProperty("--color-accent", accent);
    root.setProperty("--color-bg", palette.bg);
    root.setProperty("--color-surface", palette.surface);
    root.setProperty("--color-surface-2", palette.surface2);
    root.setProperty("--color-border", palette.border);
    root.setProperty("--color-text", palette.text);
    root.setProperty("--color-text-dim", palette.textDim);
    root.setProperty("--color-text-faint", palette.textFaint);
  }, [themeColor, themeMode]);

  return null;
}
