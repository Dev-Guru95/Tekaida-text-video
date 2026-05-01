import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tekaida — text-to-video generator",
  description:
    "Turn a one-sentence concept into a multi-shot short film. Powered by Gemini, Sora, HiggsField, and Seedance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
