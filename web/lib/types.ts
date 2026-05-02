export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "9:21";
export type Resolution = "480p" | "720p" | "1080p";
export type ProviderKey = "gemini" | "chatgpt" | "higgsfield" | "seedance";

/** What kind of media the user is generating. Each provider declares which
 *  of these it can produce via `supportedOutputs` in the provider registry.
 *  - "video": text/image-to-video (Veo, Sora, DoP, Seedance)
 *  - "image": text-to-image (Imagen, gpt-image, HF Soul)
 *  - "deck":  Gemini → JSON slides → pptxgenjs PPTX
 *  - "infographic": Imagen rendering of an AI-structured layout
 *  - "book":  multi-image illustrated PDF assembled with pdf-lib
 */
export type OutputType = "video" | "image" | "deck" | "infographic" | "book";

export const OUTPUT_TYPES: { key: OutputType; label: string; tagline: string }[] = [
  { key: "video", label: "Video", tagline: "Concept → multi-shot short film" },
  { key: "image", label: "Image", tagline: "Concept → still image gallery" },
  { key: "deck", label: "Pitch Deck", tagline: "Concept → downloadable PPTX" },
  { key: "infographic", label: "Infographic", tagline: "Concept → data-driven visual" },
  { key: "book", label: "Illustrated Book", tagline: "Concept → multi-page PDF with art" },
];

export interface Shot {
  prompt: string;
  aspect_ratio: AspectRatio;
  duration: number;
  resolution: Resolution;
  image_url?: string | null;
  label: string;
}

export interface Storyboard {
  title: string;
  logline: string;
  shots: Shot[];
}

export function slugify(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

export interface ProgressEvent {
  type: "progress";
  status: string;
}

export interface DoneEvent {
  type: "done";
  videoUrl: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type StreamEvent = ProgressEvent | DoneEvent | ErrorEvent;
