import type { Metadata } from "next";
import ReadmeEditor from "./readme-editor";

export const metadata: Metadata = {
  title: "README Editor · Vibe Check",
  description: "Build your GitHub profile README by dragging your recorded AI usage into it.",
  robots: { index: false, follow: false },
};

export default function EditPage() {
  return <ReadmeEditor />;
}
