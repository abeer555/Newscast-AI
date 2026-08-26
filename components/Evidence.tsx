"use client";

/**
 * Trust badges.
 *
 * These are the components that turn the evidence layer into something a reader
 * can act on. Each one is clickable and each one explains itself: a tier badge
 * says which outlets carried the claim, an evidence badge distinguishes outlets
 * from independent reporting chains, and the editorial-lean chip is honest about
 * being a static human-maintained classification rather than a model judgement.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Explain } from "./Explain";
import type { ClaimTier } from "@/lib/verification";
import type { EvidenceLevel, EvidenceStrength } from "@/lib/scoring";
import type { Originality } from "@/lib/independence";
import { LEAN_LABEL as SOURCE_LEAN_LABEL } from "@/lib/sources";

/* ------------------------------------------------------------------ *
 * Claim confidence tiers
 * ------------------------------------------------------------------ */

export const TIER_TEXT: Record<ClaimTier, { label: string; short: string; dot: string; tone: string }> = {
  confirmed: { label: "Confirmed", short: "3+ independent chains", dot: "🟢", tone: "good" },
  corroborated: { label: "Corroborated", short: "2 independent chains", dot: "🟢", tone: "ok" },
  reported: { label: "Reported", short: "1 chain only", dot: "🟠", tone: "warm" },
  disputed: { label: "Disputed", short: "sources conflict", dot: "🔴", tone: "bad" },
  unverified: { label: "Unverified", short: "no attribution found", dot: "⚪", tone: "dim" },
};

export function TierBadge({
  tier,
  reason,
  outlets,
  chains,
  compact,
}: {
  tier: ClaimTier;
  reason?: string;
  outlets?: string[];
  chains?: string[];
  compact?: boolean;
}) {
  const t = TIER_TEXT[tier] ?? TIER_TEXT.unverified;
  return (
    <span className={`tier tier-${t.tone}`}>
      <span className="tier-dot" aria-hidden>
        {t.dot}
      </span>
      <span className="tier-label">{t.label}</span>
      {!compact && <span className="tier-sub">{t.short}</span>}
      {(reason || outlets?.length) && (
        <Explain title={`Why "${t.label}"?`} label="?" width={330}>
          {reason && <p className="ex-p">{reason}</p>}
          {!!chains?.length && (
            <p className="ex-p">
              <b>Independent chains:</b> {chains.join(", ")}
            </p>
          )}
          {!!outlets?.length && (
            <p className="ex-p">
              <b>Outlets carrying it:</b> {outlets.join(", ")}
            </p>
          )}
          <p className="ex-p dim">
            Tiers count independent reporting chains, not outlet logos — ten papers running one
            agency dispatch is a single chain.{" "}
            <Link className="ex-link" href="/methodology#tiers">
              Methodology
            </Link>
          </p>
        </Explain>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Evidence strength for a whole story
 * ------------------------------------------------------------------ */

const LEVEL_DOT: Record<EvidenceLevel, string> = { strong: "🟢", moderate: "🟢", limited: "🟠", single: "🔴" };
const LEVEL_TONE: Record<EvidenceLevel, string> = { strong: "good", moderate: "ok", limited: "warm", single: "bad" };

export function EvidenceBadge({ evidence, compact }: { evidence: EvidenceStrength; compact?: boolean }) {
  return (
    <span className={`tier tier-${LEVEL_TONE[evidence.level]}`}>
      <span className="tier-dot" aria-hidden>
        {LEVEL_DOT[evidence.level]}
      </span>
      <span className="tier-label">{evidence.label}</span>
      {!compact && <span className="tier-sub">{evidence.summary}</span>}
      <Explain title="Evidence strength" label="?" width={350}>
        <p className="ex-p">{evidence.note}</p>
        <p className="ex-p">
          <b>{evidence.outlets}</b> outlets · <b>{evidence.independent}</b> independent reporting{" "}
          {evidence.independent === 1 ? "chain" : "chains"}
          {evidence.syndicated ? ` · ${evidence.syndicated} syndicated copies` : ""}
        </p>
        {evidence.caveat && <p className="ex-p warn">{evidence.caveat}</p>}
        <p className="ex-p dim">
          <Link className="ex-link" href="/methodology#independence">
            How independence is determined
          </Link>
        </p>
      </Explain>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Per-article provenance
 * ------------------------------------------------------------------ */

const ORIGIN_TONE: Record<Originality, string> = {
  original: "good",
  wire_origin: "info",
  syndicated: "warm",
  mixed: "info",
  unattributed: "dim",
};

export function OriginalityChip({
  originality,
  label,
  basis,
  chainLabel,
}: {
  originality: Originality;
  label: string;
  basis?: string;
  chainLabel?: string;
}) {
  return (
    <span className={`chip prov prov-${ORIGIN_TONE[originality]}`}>
      {label}
      {basis && (
        <Explain title="How this was classified" label="?" width={320}>
          <p className="ex-p">{basis}</p>
          {chainLabel && (
            <p className="ex-p">
              <b>Reporting chain:</b> {chainLabel}
            </p>
          )}
          <p className="ex-p dim">
            Classified from the byline and from body-text duplication across outlets — never from an
            outlet&apos;s reputation.{" "}
            <Link className="ex-link" href="/methodology#independence">
              Methodology
            </Link>
          </p>
        </Explain>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Editorial lean — demoted to a provenance chip
 * ------------------------------------------------------------------ */

export const LEAN_LABEL = SOURCE_LEAN_LABEL;

export function LeanChip({ lean }: { lean: string | null | undefined }) {
  if (!lean) return null;
  const label = LEAN_LABEL[lean] ?? lean;
  return (
    <span className="chip lean">
      {label}
      <Explain title="Where this label comes from" label="?" width={340}>
        <p className="ex-p">
          A fixed, editor-maintained classification of the outlet, stored alongside its feed. It is{" "}
          <b>not</b> inferred by a model and it says nothing about the accuracy of this particular
          article.
        </p>
        <p className="ex-p">
          Treat it as context for interpreting emphasis and word choice, not as a quality signal. The
          claim tiers above are the accuracy measure.
        </p>
        <p className="ex-p dim">
          <Link className="ex-link" href="/methodology#lean">
            Full list and how it is maintained
          </Link>
        </p>
      </Explain>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Forecast confidence for "what happens next"
 * ------------------------------------------------------------------ */

export type ForecastLevel = "likely" | "expected" | "possible" | "unknown";

export const FORECAST_TEXT: Record<ForecastLevel, { label: string; basis: string; tone: string }> = {
  likely: {
    label: "Likely",
    basis: "A scheduled or already-announced event — a set court date, a called vote, a published deadline.",
    tone: "good",
  },
  expected: {
    label: "Expected",
    basis: "A step multiple outlets describe as planned, but without a confirmed date or commitment.",
    tone: "ok",
  },
  possible: {
    label: "Possible",
    basis: "A plausible development raised by at least one outlet; no commitment or schedule exists.",
    tone: "warm",
  },
  unknown: {
    label: "Unknown",
    basis: "Nothing in the coverage indicates what happens next. This is a gap, not a forecast.",
    tone: "dim",
  },
};

export function ForecastChip({ level }: { level: ForecastLevel }) {
  const f = FORECAST_TEXT[level];
  return (
    <span className={`chip forecast forecast-${f.tone}`}>
      {f.label}
      <Explain title={`"${f.label}" means`} label="?" width={320}>
        <p className="ex-p">{f.basis}</p>
        <p className="ex-p dim">
          Assigned from the language in the coverage, not from a prediction model. Nothing here is a
          forecast of what will happen.
        </p>
      </Explain>
    </span>
  );
}

/**
 * Classifies a "what happens next" sentence into a confidence tier from its own
 * hedging language — the honest reading of a line the model wrote.
 */
export function forecastLevelOf(text: string): ForecastLevel {
  const s = text.toLowerCase();
  if (/\b(unclear|unknown|no indication|not known|has not said|remains to be seen|no timeline)\b/.test(s)) return "unknown";
  if (/\b(scheduled|due (on|to)|is set to|will take place|deadline|court date|vote on|summit on|report due|hearing)\b/.test(s)) return "likely";
  if (/\b(may|might|could|possibly|potentially|risks?|if\b)\b/.test(s)) return "possible";
  if (/\b(expected|plans? to|is likely to|anticipated|intends?)\b/.test(s)) return "expected";
  return "possible";
}

/* ------------------------------------------------------------------ *
 * Small shared pieces
 * ------------------------------------------------------------------ */

export function SourceCount({ outlets, independent }: { outlets: number; independent: number }) {
  return (
    <span className="src-count">
      <b>{outlets}</b> {outlets === 1 ? "outlet" : "outlets"}
      <span className="dim"> / </span>
      <b>{independent}</b> independent {independent === 1 ? "chain" : "chains"}
    </span>
  );
}

export function Panel({
  title,
  sub,
  right,
  children,
  tone,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  tone?: "good" | "warm" | "bad" | "dim";
}) {
  return (
    <section className={`panel-box ${tone ? `tone-${tone}` : ""}`}>
      <header className="panel-head">
        <div>
          <h3 className="panel-title">{title}</h3>
          {sub && <p className="panel-sub">{sub}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}
