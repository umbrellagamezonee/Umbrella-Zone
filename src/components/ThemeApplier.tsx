import { useEffect } from "react";
import { useSettingsStore } from "../store/useSettingsStore";
import { themeShades } from "../lib/color";

// Pushes the chosen theme color onto :root as CSS variables, overriding the
// defaults baked into index.css. Renders nothing — just keeps the page in
// sync whenever the color changes in Settings.
export function ThemeApplier() {
  const themeColor = useSettingsStore((s) => s.themeColor);

  useEffect(() => {
    const { primary, primaryDark, accent } = themeShades(themeColor);
    const root = document.documentElement.style;
    root.setProperty("--color-primary", primary);
    root.setProperty("--color-primary-dark", primaryDark);
    root.setProperty("--color-accent", accent);
  }, [themeColor]);

  return null;
}
