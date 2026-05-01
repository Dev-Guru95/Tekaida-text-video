import type { ProviderKey } from "./types";

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
      name: "Gemini Veo",
      description: "Google Veo 3 — text-to-video",
      available: geminiAvail,
      missingMessage:
        "set GEMINI_API_KEY in web/.env.local (https://aistudio.google.com/apikey)",
      cliOnly: false,
      requiresImage: false,
    },
    {
      key: "chatgpt",
      name: "OpenAI Sora",
      description: "OpenAI Sora 2 — text-to-video",
      available: openaiAvail,
      missingMessage:
        "set OPENAI_API_KEY in web/.env.local (https://platform.openai.com/api-keys)",
      cliOnly: false,
      requiresImage: false,
    },
    {
      key: "higgsfield",
      name: "HiggsField",
      description: "HiggsField DoP — image-to-video (reference image required)",
      available: hfAvail,
      missingMessage:
        "set HF_KEY in web/.env.local — get credentials at https://cloud.higgsfield.ai/",
      cliOnly: false,
      requiresImage: true,
    },
    {
      key: "seedance",
      name: "Seedance 2.0",
      description: "ByteDance Seedance via HiggsField — image-to-video (reference image required)",
      available: hfAvail,
      missingMessage:
        "Seedance routes through HiggsField — set HF_KEY in web/.env.local",
      cliOnly: false,
      requiresImage: true,
    },
  ];
}

export function getProvider(key: ProviderKey): ProviderInfo {
  const found = checkProviders().find((p) => p.key === key);
  if (!found) throw new Error(`Unknown provider: ${key}`);
  return found;
}
