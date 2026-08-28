"use client";

import { useState } from "react";
import { isTheme, setStoredTheme, THEMES, THEME_META, type Theme } from "@/lib/theme";

// The blocking script in layout.tsx already stamped data-theme onto <html>
// before this component hydrates, so read it back synchronously instead of
// defaulting to "manuscript" and correcting in an effect after mount (which
// would render the wrong active theme for one frame). suppressHydrationWarning
// covers the resulting mismatch against the server's theme-less markup, same
// as the <html> tag itself already does.
function currentTheme(): Theme {
  if (typeof document === "undefined") return "manuscript";
  const attr = document.documentElement.getAttribute("data-theme");
  return isTheme(attr) ? attr : "manuscript";
}

/** Full picker: three named cards with swatches and a blurb. For the home page. */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  function choose(t: Theme) {
    setTheme(t);
    setStoredTheme(t);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {THEMES.map((t) => {
        const meta = THEME_META[t];
        const active = theme === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => choose(t)}
            className="field text-left space-y-1.5 p-2.5"
            style={active ? { borderColor: "var(--accent)", borderWidth: 2 } : undefined}
            suppressHydrationWarning
          >
            <div className="flex gap-1">
              {meta.swatches.map((c, i) => (
                <span key={i} className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: c }} />
              ))}
            </div>
            <p className="text-xs font-semibold">{meta.label}</p>
            <p className="text-[11px] opacity-60 leading-snug">{meta.blurb}</p>
          </button>
        );
      })}
    </div>
  );
}

/** Compact cycle button: tap to rotate through themes. For the in-game header. */
export function ThemeCycleButton() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  function cycle() {
    const idx = THEMES.indexOf(theme);
    const next = THEMES[(idx + 1) % THEMES.length];
    setTheme(next);
    setStoredTheme(next);
  }

  return (
    <button
      onClick={cycle}
      className="btn-icon"
      title={`Theme: ${THEME_META[theme].label} (tap to change)`}
      suppressHydrationWarning
    >
      {theme === "manuscript" ? "📖" : theme === "stage" ? "🎭" : "🖥️"}
    </button>
  );
}
