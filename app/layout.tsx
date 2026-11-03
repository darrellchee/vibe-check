import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ViewTransition } from "react";
import "./globals.css";

// Variable Inter (100–900), self-hosted by next/font. Exposed as a CSS variable so only the
// dashboard opts in; the editor and setup pages keep their own type.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
export const metadata: Metadata = {
  title: "Codex Vibe Check · Your work, in perspective",
  description:
    "A personal observatory for your Codex usage. Tokens, activity, models and API-equivalent value.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {/* Page changes animate as one view transition. Links tag the direction (see
            ProviderNavigation); other links and redirects get a crossfade. Browser back and
            forward swap instantly. The layout stays mounted, so this runs as an "update". */}
        <ViewTransition
          default="none"
          update={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-fade" }}
        >
          {children}
        </ViewTransition>
      </body>
    </html>
  );
}
