import type { Metadata } from "next";
import { Mona_Sans } from "next/font/google";
import ReadmePreview from "./readme-preview";

// GitHub's UI font, self-hosted by next/font, for the GitHub-style profile the README is shown in.
const mona = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], display: "swap", variable: "--font-mona" });

export const metadata: Metadata = {
  title: "README Preview · Vibe Check",
  description: "See your GitHub profile README as GitHub will show it, then publish it.",
  robots: { index: false, follow: false },
};

export default function PreviewPage() {
  return <ReadmePreview fontClass={mona.variable} />;
}
