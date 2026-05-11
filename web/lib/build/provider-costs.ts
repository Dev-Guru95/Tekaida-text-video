/**
 * Provider wholesale cost estimates + spend guardrails.
 *
 * Every render burns money on the provider's side. To never spend more than
 * we earn, we apply three independent checks at submit time:
 *
 *   1. Margin floor   — wholesale cost must be <= (revenue / MARGIN_FLOOR).
 *   2. Per-render cap — a single render can't cost more than MAX_PER_RENDER_USD.
 *   3. Monthly budget — total spend on a provider this calendar month can't
 *                       exceed its configured budget.
 *
 * All amounts are kept in USD CENTS (int) to dodge floating-point drift.
 *
 * Tuning:
 *   - The per-second rates below are approximations. Once you have real
 *     billing data from each provider, replace the numbers here and redeploy.
 *   - Budgets are env-driven so you can tighten without code changes:
 *       GEMINI_MONTHLY_BUDGET_USD=50
 *       HF_MONTHLY_BUDGET_USD=200
 *       OPENAI_MONTHLY_BUDGET_USD=50
 *       MARGIN_FLOOR=1.5    (charge at least 1.5x our wholesale cost)
 *       MAX_PER_RENDER_USD=5  (kill-switch for outlier prompts)
 */

import type { ProviderKey, Resolution } from "@/lib/types";

/** USD cents we estimate the provider charges per second of generated video. */
const PER_SECOND_CENTS: Record<ProviderKey, number> = {
  // SeaDance 1.0 Pro via HiggsField — roughly $0.03 / second at 720p
  seedance:   3,
  // HiggsField DoP — similar tier
  higgsfield: 3,
  // Google Veo 3 (paid tier) — markedly more expensive per second
  gemini:     20,
  // OpenAI Sora 2 — premium tier
  chatgpt:    15,
};

/** Same multipliers we charge users — keeps wholesale and retail comparable. */
const RES_MULT: Record<Resolution, number> = {
  "480p": 0.6,
  "720p": 1.0,
  "1080p": 1.5,
};

const RETAIL_CREDIT_USD_CENTS = 1; // 1 Tekaida credit = $0.01 retail
const DEFAULT_MARGIN_FLOOR = 1.5;
const DEFAULT_MAX_PER_RENDER_USD = 5;
const DEFAULT_MONTHLY_BUDGETS_USD: Record<ProviderKey, number> = {
  seedance:   500,   // assumes paid HiggsField account ($500/mo ceiling)
  higgsfield: 500,
  gemini:     50,    // matches Google's typical small-project cap
  chatgpt:    50,
};

export interface WholesaleEstimate {
  cents: number;
  perSecondCents: number;
  resolutionMult: number;
  duration: number;
}

export function estimateWholesaleCostCents(
  provider: ProviderKey,
  duration: number,
  resolution: Resolution,
): WholesaleEstimate {
  const perSecondCents = PER_SECOND_CENTS[provider] ?? 5;
  const resolutionMult = RES_MULT[resolution] ?? 1.0;
  const cents = Math.max(
    1,
    Math.round(perSecondCents * Math.max(1, duration) * resolutionMult),
  );
  return { cents, perSecondCents, resolutionMult, duration };
}

export function marginFloor(): number {
  const v = Number(process.env.MARGIN_FLOOR ?? DEFAULT_MARGIN_FLOOR);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MARGIN_FLOOR;
}

export function maxPerRenderCents(): number {
  const usd = Number(process.env.MAX_PER_RENDER_USD ?? DEFAULT_MAX_PER_RENDER_USD);
  return Math.max(1, Math.round((Number.isFinite(usd) && usd > 0 ? usd : DEFAULT_MAX_PER_RENDER_USD) * 100));
}

export function monthlyBudgetCents(provider: ProviderKey): number {
  const envKey = `${envPrefix(provider)}_MONTHLY_BUDGET_USD`;
  const fromEnv = Number(process.env[envKey]);
  const usd = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MONTHLY_BUDGETS_USD[provider];
  return Math.max(1, Math.round(usd * 100));
}

function envPrefix(provider: ProviderKey): string {
  switch (provider) {
    case "seedance":   return "SEEDANCE";
    case "higgsfield": return "HF";
    case "gemini":     return "GEMINI";
    case "chatgpt":    return "OPENAI";
    default:           return "PROVIDER";
  }
}

/**
 * Returns a list of policy violations for this render. Empty array = safe to
 * proceed. Each entry has a stable `code` so callers can branch on it.
 */
export function checkSpendPolicy(opts: {
  provider: ProviderKey;
  estimateCents: number;
  retailCredits: number;
  spentThisMonthCents: number;
}): { code: string; message: string }[] {
  const violations: { code: string; message: string }[] = [];

  const revenueCents = opts.retailCredits * RETAIL_CREDIT_USD_CENTS;
  const floor = marginFloor();
  if (revenueCents < opts.estimateCents * floor) {
    violations.push({
      code: "margin_floor",
      message:
        `Render skipped: estimated cost (${formatUSD(opts.estimateCents)}) would breach margin floor (${floor}x). ` +
        `User would pay ${formatUSD(revenueCents)}. Lower duration/resolution or pick a cheaper engine.`,
    });
  }

  const perRenderCap = maxPerRenderCents();
  if (opts.estimateCents > perRenderCap) {
    violations.push({
      code: "per_render_cap",
      message:
        `Render skipped: estimated cost ${formatUSD(opts.estimateCents)} exceeds the per-render cap ${formatUSD(perRenderCap)}. ` +
        `Adjust MAX_PER_RENDER_USD or pick a shorter clip.`,
    });
  }

  const budgetCents = monthlyBudgetCents(opts.provider);
  if (opts.spentThisMonthCents + opts.estimateCents > budgetCents) {
    violations.push({
      code: "monthly_budget",
      message:
        `Render skipped: ${opts.provider} monthly budget reached (${formatUSD(opts.spentThisMonthCents)} of ${formatUSD(budgetCents)}). ` +
        `Try another engine or raise the budget env var ($${envPrefix(opts.provider)}_MONTHLY_BUDGET_USD).`,
    });
  }

  return violations;
}

export function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
