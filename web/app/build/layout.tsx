import type { Metadata } from "next";
import "../build.css";

export const metadata: Metadata = {
  title: "Tekaida Build — cinematic AI video studio",
  description:
    "Prompt-to-video with SeaDance 2.0. Cinematic camera moves, motion presets, character consistency, render queue, and team workspaces.",
};

export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return <div className="build-shell">{children}</div>;
}
