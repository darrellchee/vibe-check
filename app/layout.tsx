import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Codex Atlas · Your work, in perspective",
  description:
    "A personal observatory for your Codex usage. Tokens, activity, models and API-equivalent value.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
