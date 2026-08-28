export const THEMES = ["manuscript", "stage", "editor"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_META: Record<Theme, { label: string; blurb: string; swatches: string[] }> = {
  manuscript: {
    label: "Manuscript",
    blurb: "Cream paper, serif ink, gold-leaf accent.",
    swatches: ["#fdfaf6", "#db2777", "#201a17"],
  },
  stage: {
    label: "Stage",
    blurb: "Spotlight and curtain-red, for performers.",
    swatches: ["#0b0708", "#c81e3a", "#d4af37"],
  },
  editor: {
    label: "Editor",
    blurb: "Clean, minimal, distraction-free.",
    swatches: ["#ffffff", "#2563eb", "#171717"],
  },
};

// Browser chrome / address-bar color per theme (matches each theme's page
// background). Exported so layout.tsx's pre-hydration script can inline it
// instead of hardcoding a second copy that could drift from this file.
export const THEME_COLORS: Record<Theme, string> = {
  manuscript: "#fdfaf6",
  stage: "#0b0708",
  editor: "#ffffff",
};

// Exported (rather than module-private) so layout.tsx's pre-hydration script
// can read the same key instead of hardcoding a second copy that could drift.
export const THEME_KEY = "story-chain:theme";

export function isTheme(value: string | null): value is Theme {
  return !!value && (THEMES as readonly string[]).includes(value);
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "manuscript";
  const stored = localStorage.getItem(THEME_KEY);
  return isTheme(stored) ? stored : "manuscript";
}

export function setStoredTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}
