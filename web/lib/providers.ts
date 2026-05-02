import type { OutputType, ProviderKey } from "./types";

export interface ProviderInfo {
  key: ProviderKey;
  name: string;
  description: string;
  available: boolean;
  missingMessage: string;
  cliOnly: boolean;
  /** True when the provider only supports image-to-video and a reference
   *  image URL is mandatory. The UI uses this to enforce the field. */
  requiresImage: boolean;
  /** Which OutputType modes this provider can serve. The UI hides a provider
   *  card when the currently selected output type isn't supported. */
  supportedOutputs: OutputType[];
}

export function checkProviders(): ProviderInfo[] {
  const geminiAvail = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const openaiAvail = !!process.env.OPENAI_API_KEY;
  const hfAvail = !!(
    process.env.HF_KEY ||
    (process.env.HF_API_KEY && process.env.HF_API_SECRET)
  );

  return [
    {
      key: "gemini",
      name: "Gemini",
      description: "Google Veo 3 (video) + Imagen 4 (image) + Gemini text",
      available: geminiAvail,
      missingMessage:
        "set GEMINI_API_KEY in web/.env.local (https://aistudio.google.com/apikey)",
      cliOnly: false,
      requiresImage: false,
      supportedOutputs: ["video", "image", "deck", "infographic", "book"],
    },
    {
      key: "chatgpt",
      name: "OpenAI",
      description: "Sora 2 (video) + gpt-image-1 (image)",
      available: openaiAvail,
      missingMessage:
        "set OPENAI_API_KEY in web/.env.local (https://platform.openai.com/api-keys)",
      cliOnly: false,
      requiresImage: false,
      supportedOutputs: ["video", "image", "deck", "infographic", "book"],
    },
    {
      key: "higgsfield",
      name: "HiggsField",
      description: "DoP video (image-to-video) + Soul image",
      available: hfAvail,
      missingMessage:
        "set HF_KEY in web/.env.local — get credentials at https://cloud.higgsfield.ai/",
      cliOnly: false,
      requiresImage: true,
      supportedOutputs: ["video", "image"],
    },
    {
      key: "seedance",
      name: "Seedance 2.0",
      description: "ByteDance Seedance via HiggsField — image-to-video only",
      available: hfAvail,
      missingMessage:
        "Seedance routes through HiggsField — set HF_KEY in web/.env.local",
      cliOnly: false,
      requiresImage: true,
      supportedOutputs: ["video"],
    },
  ];
}

export function getProvider(key: ProviderKey): ProviderInfo {
  const found = checkProviders().find((p) => p.key === key);
  if (!found) throw new Error(`Unknown provider: ${key}`);
  return found;
}
