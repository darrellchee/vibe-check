import type { Metadata } from "next";
import { Mona_Sans } from "next/font/google";
import ReadmeEditor from "./readme-editor";

// GitHub's UI font, self-hosted by next/font like the static profile copy.
const mona = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], display: "swap", variable: "--font-mona" });

export const metadata: Metadata = {
  title: "README Editor · Atlas",
  description: "Build your GitHub profile README by dragging your recorded AI usage into it.",
  robots: { index: false, follow: false },
};

export default function EditPage() {
  return <ReadmeEditor fontClass={mona.variable} />;
}
