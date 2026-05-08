import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tekaida — text-to-video generator",
  description:
    "Turn a one-sentence concept into a multi-shot short film. Powered by Gemini, Sora, HiggsField, and Seedance.",
};

// Without an explicit viewport export, Next 15 omits the meta tag and mobile
// browsers default to a ~980px desktop viewport, scale-shrinking the whole
// page to fit. This makes the live site look "zoomed out" on phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
