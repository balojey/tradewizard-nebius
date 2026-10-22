import { loadFont as loadUbuntu } from "@remotion/google-fonts/Ubuntu";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const ubuntu = loadUbuntu("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});

const mono = loadMono("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});

export const fontSans = ubuntu.fontFamily;
export const fontMono = mono.fontFamily;

export type Theme = "dark" | "light";

const darkVars: Record<string, string> = {
  "--tw-bg": "oklch(14% 0.015 260)",
  "--tw-surface": "oklch(19% 0.012 260)",
  "--tw-surface-2": "oklch(24% 0.01 260)",
  "--tw-surface-3": "oklch(27% 0.012 260)",
  "--tw-fg": "oklch(97% 0.005 260)",
  "--tw-muted": "oklch(66% 0.012 260)",
  "--tw-border": "oklch(30% 0.01 260)",
  "--tw-border-strong": "oklch(40% 0.014 260)",
  "--tw-accent": "oklch(62% 0.2 260)",
  "--tw-accent-deep": "oklch(55% 0.2 270)",
  "--tw-ai": "oklch(62% 0.18 295)",
  "--tw-yes": "oklch(72% 0.16 155)",
  "--tw-no": "oklch(65% 0.18 25)",
  "--tw-warning": "oklch(78% 0.14 85)",
  "--tw-grid": "oklch(30% 0.01 260 / 0.4)",
  "--tw-vignette": "oklch(8% 0.01 260 / 0.42)",
  "--tw-surface-grad": "oklch(21% 0.016 265)",
  "--tw-no-soft": "oklch(38% 0.06 25)",
  "--tw-shadow": "oklch(0% 0 0 / 0.65)",
  "--tw-shadow-strong": "oklch(0% 0 0 / 0.85)",
};

const lightVars: Record<string, string> = {
  "--tw-bg": "oklch(98% 0.003 260)",
  "--tw-surface": "oklch(100% 0 0)",
  "--tw-surface-2": "oklch(95% 0.004 260)",
  "--tw-surface-3": "oklch(100% 0 0)",
  "--tw-fg": "oklch(18% 0.015 260)",
  "--tw-muted": "oklch(45% 0.012 260)",
  "--tw-border": "oklch(88% 0.006 260)",
  "--tw-border-strong": "oklch(78% 0.008 260)",
  "--tw-accent": "oklch(52% 0.2 260)",
  "--tw-accent-deep": "oklch(45% 0.2 270)",
  "--tw-ai": "oklch(48% 0.18 295)",
  "--tw-yes": "oklch(45% 0.14 155)",
  "--tw-no": "oklch(55% 0.18 25)",
  "--tw-warning": "oklch(55% 0.14 85)",
  "--tw-grid": "oklch(88% 0.006 260 / 0.7)",
  "--tw-vignette": "oklch(82% 0.008 260 / 0.16)",
  "--tw-surface-grad": "oklch(96% 0.006 260)",
  "--tw-no-soft": "oklch(84% 0.05 25)",
  "--tw-shadow": "oklch(20% 0.02 260 / 0.18)",
  "--tw-shadow-strong": "oklch(20% 0.02 260 / 0.3)",
};

export function themeCss(theme: Theme) {
  const vars = theme === "light" ? lightVars : darkVars;
  return `.tw-theme-${theme}{${Object.entries(vars)
    .map(([key, value]) => `${key}:${value};`)
    .join("")}}`;
}

export const palette = {
  bg: "var(--tw-bg)",
  surface: "var(--tw-surface)",
  surface2: "var(--tw-surface-2)",
  surface3: "var(--tw-surface-3)",
  fg: "var(--tw-fg)",
  muted: "var(--tw-muted)",
  border: "var(--tw-border)",
  borderStrong: "var(--tw-border-strong)",
  accent: "var(--tw-accent)",
  accentDeep: "var(--tw-accent-deep)",
  ai: "var(--tw-ai)",
  yes: "var(--tw-yes)",
  no: "var(--tw-no)",
  warning: "var(--tw-warning)",
  white: "#ffffff",
  black: "oklch(0% 0 0)",
} as const;

export const shadow = {
  card: "0 18px 50px -20px var(--tw-shadow)",
  modal: "0 40px 120px -30px var(--tw-shadow-strong)",
  glow: "0 0 60px -12px oklch(62% 0.2 260 / 0.5)",
} as const;
