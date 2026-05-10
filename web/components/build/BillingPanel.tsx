"use client";

import { useEffect, useState } from "react";
import type { CreditPack } from "@/lib/build/credits";

interface LedgerRow {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
}

export function BillingPanel({
  onTopupSuccess,
  balance,
}: {
  onTopupSuccess: () => void;
  balance: number;
}) {
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [lifetime, setLifetime] = useState(0);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/build/credits", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setPacks(d.packs ?? []);
        setLedger(d.ledger ?? []);
        setLifetime(d.lifetime_topup ?? 0);
      })
      .catch(() => undefined);
  }, []);

  // If we just came back from Stripe, refresh balance.
  useEffect(() => {
    const url = typeof window !== "undefined" ? new URL(window.location.href) : null;
    if (url?.searchParams.get("topup") === "success") {
      onTopupSuccess();
    }
  }, [onTopupSuccess]);

  const buy = async (slug: string) => {
    setError(null);
    setBusyPack(slug);
    try {
      const r = await fetch("/api/build/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packSlug: slug }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      window.location.href = d.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyPack(null);
    }
  };

  return (
    <div className="ws-root">
      <header className="ws-header">
        <div>
          <h2 className="ws-title">Billing</h2>
          <p className="ws-sub">
            Pre-paid credits. 1 credit ≈ $0.01. ~5 credits / second of 720p video; double for 1080p.
          </p>
        </div>
        <div className="ws-cost-pill">
          <span className="ws-cost-label">balance</span>
          <span className="ws-cost-value">{balance.toLocaleString()} cr</span>
        </div>
      </header>

      <div className="billing-stats">
        <div className="billing-stat">
          <span className="billing-stat-label">Lifetime topup</span>
          <span className="billing-stat-value">{lifetime.toLocaleString()} cr</span>
        </div>
        <div className="billing-stat">
          <span className="billing-stat-label">Current balance</span>
          <span className="billing-stat-value">{balance.toLocaleString()} cr</span>
        </div>
      </div>

      <h3 className="ws-h3">Top up</h3>
      <div className="pack-grid">
        {packs.map((p) => (
          <article key={p.slug} className={`pack-card ${p.highlight ? "highlight" : ""}`}>
            {p.highlight && <span className="pack-flag">most popular</span>}
            <h4 className="pack-name">{p.label}</h4>
            <div className="pack-credits">{p.credits.toLocaleString()} <span>credits</span></div>
            <div className="pack-price">${p.priceUsd}</div>
            <button
              className="btn pack-cta"
              type="button"
              disabled={busyPack === p.slug}
              onClick={() => buy(p.slug)}
            >
              {busyPack === p.slug ? "Redirecting…" : "Buy"}
            </button>
          </article>
        ))}
      </div>
      {error && <div className="ws-error">{error}</div>}

      <h3 className="ws-h3">Recent activity</h3>
      {ledger.length === 0 ? (
        <div className="ws-empty">
          <span className="ws-empty-glyph">·</span>
          <span>No activity yet.</span>
        </div>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr>
              <th>date</th>
              <th>reason</th>
              <th>change</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{labelReason(row.reason)}</td>
                <td className={row.amount >= 0 ? "ledger-credit" : "ledger-debit"}>
                  {row.amount >= 0 ? "+" : ""}
                  {row.amount.toLocaleString()} cr
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function labelReason(r: string): string {
  switch (r) {
    case "signup_bonus": return "Signup bonus";
    case "stripe_topup": return "Top-up (Stripe)";
    case "render_job":   return "Render job";
    case "refund":       return "Refund";
    case "admin_grant":  return "Admin grant";
    default:             return r;
  }
}
