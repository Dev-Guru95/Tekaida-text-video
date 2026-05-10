/**
 * Credit cost calculator. One source of truth — both the client-side cost
 * preview and the server-side debit step call into this so we never bill
 * differently from what was quoted.
 *
 * Pricing model (tunable here, no DB migration needed):
 *   - Base: 5 credits per second of output
 *   - 1080p × 1.5, 720p × 1.0, 480p × 0.6
 *   - motion intensity multiplier: subtle/natural 1.0, kinetic/timelapse 1.2, slow-mo/explosive 1.5
 *   - Minimum 30 credits per render so a 4-second 480p test still costs something.
 *
 * 100 credits ≈ $1 retail (Stripe top-up packs ship at $5 / $20 / $50).
 */

import { findMotion } from "./presets";
import type { Resolution } from "@/lib/types";

const PER_SECOND_BASE = 5;
const RES_MULT: Record<Resolution, number> = {
  "480p": 0.6,
  "720p": 1.0,
  "1080p": 1.5,
};
const MIN_COST = 30;

export function estimateCreditsCost(opts: {
  duration: number;          // seconds
  resolution: Resolution;
  motionSlug?: string | null;
}): number {
  const motion = findMotion(opts.motionSlug);
  const motionMult = motion?.intensity === 3 ? 1.5 : motion?.intensity === 2 ? 1.2 : 1.0;
  const raw = PER_SECOND_BASE * Math.max(1, opts.duration) * RES_MULT[opts.resolution] * motionMult;
  return Math.max(MIN_COST, Math.round(raw));
}

export interface CreditPack {
  slug: string;
  label: string;
  credits: number;
  priceUsd: number;
  highlight?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  { slug: "starter",  label: "Starter",  credits: 500,   priceUsd: 5 },
  { slug: "creator",  label: "Creator",  credits: 2200,  priceUsd: 20, highlight: true },
  { slug: "studio",   label: "Studio",   credits: 6000,  priceUsd: 50 },
  { slug: "agency",   label: "Agency",   credits: 14000, priceUsd: 100 },
];

export function findCreditPack(slug: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.slug === slug);
}
