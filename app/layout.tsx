import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Lora, Playfair_Display } from "next/font/google";
import { THEMES, THEME_KEY, THEME_COLORS } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

// Applies the viewer's saved theme (and matching browser-chrome color)
// before first paint, so there's no flash of the default theme. Reads
// localStorage directly (client only, sync). The theme list/key/colors are
// interpolated from lib/theme.ts so this can't drift out of sync with it.
const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem(${JSON.stringify(THEME_KEY)});
  var themes = ${JSON.stringify(THEMES)};
  var colors = ${JSON.stringify(THEME_COLORS)};
  if (themes.indexOf(t) !== -1) {
    document.documentElement.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", colors[t]);
  }
} catch (e) {}
`;

export const metadata: Metadata = {
  title: "Story Chain",
  description: "AI-judged collaborative story game - last writer standing wins.",
};

export const viewport: Viewport = {
  themeColor: THEME_COLORS.manuscript,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} ${playfair.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
