export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "9:21";
export type Resolution = "480p" | "720p" | "1080p";
export type ProviderKey = "gemini" | "chatgpt" | "higgsfield" | "seedance";

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
