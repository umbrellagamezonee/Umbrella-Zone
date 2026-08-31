// Small color helpers for the theme customizer — one hex pick from the user
// drives a coherent primary/primary-dark/accent set instead of asking them
// to pick three colors that have to work together.

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.min(100, Math.max(0, s)) / 100;
  l = Math.min(100, Math.max(0, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n: number) =>
    Math.round(f(n) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

export interface ThemeShades {
  primary: string;
  primaryDark: string;
  accent: string;
}

// Clamps lightness/saturation so any pick stays legible with white button
// text and distinct enough from the near-black app background.
export function themeShades(baseHex: string): ThemeShades {
  const isValid = /^#[0-9a-fA-F]{6}$/.test(baseHex);
  const [h, sRaw, lRaw] = hexToHsl(isValid ? baseHex : "#8b5cf6");
  const s = Math.max(35, sRaw);
  const l = Math.min(62, Math.max(38, lRaw));
  return {
    primary: hslToHex(h, s, l),
    primaryDark: hslToHex(h, s, Math.max(16, l - 18)),
    accent: hslToHex(h, Math.max(s - 10, 30), Math.min(80, l + 18)),
  };
}
