"use client";

/**
 * Explainability primitives.
 *
 * Every score this product shows is a judgement, and a judgement the reader
 * cannot inspect is just a number with confidence. `Explain` is the one popover
 * used everywhere a figure appears; `Breakdown` renders the itemised arithmetic
 * that produced it, straight from the scoring engine, so the explanation can
 * never drift out of sync with the maths.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ScoreComponent } from "@/lib/scoring";

export function Explain({
  title,
  children,
  label = "Why?",
  align = "right",
  width = 340,
  tone = "quiet",
}: {
  title: string;
  children: ReactNode;
  label?: ReactNode;
  align?: "left" | "right";
  width?: number;
  /** "cite" renders as a superscript citation marker inside running prose. */
  tone?: "quiet" | "link" | "cite" | "cite-weak";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="explain" ref={wrapRef}>
      <button
        type="button"
        className={`explain-btn ${tone}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        {label}
      </button>
      {open && (
        <span
          id={panelId}
          role="dialog"
          aria-label={title}
          className={`explain-panel ${align}`}
          style={{ width }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="explain-title">{title}</span>
          <span className="explain-body">{children}</span>
        </span>
      )}
    </span>
  );
}

/** Itemised arithmetic: one row per component, then the formula that combined them. */
export function Breakdown({
  components,
  formula,
  result,
  resultLabel = "Score",
  note,
}: {
  components: ScoreComponent[];
  formula?: string;
  result?: number | string;
  resultLabel?: string;
  note?: ReactNode;
}) {
  return (
    <span className="breakdown">
      {components.map((c) => (
        <span className="bd-row" key={c.label}>
          <span className="bd-main">
            <span className="bd-label">{c.label}</span>
            <span className="bd-value mono">
              {c.kind === "multiply" ? "×" : "+"}
              {typeof c.value === "number" ? round(c.value) : c.value}
            </span>
          </span>
          <span className="bd-detail">{c.detail}</span>
        </span>
      ))}
      {formula && <span className="bd-formula mono">{formula}</span>}
      {result !== undefined && (
        <span className="bd-total">
          <span>{resultLabel}</span>
          <span className="mono">{typeof result === "number" ? round(result) : result}</span>
        </span>
      )}
      {note && <span className="bd-note">{note}</span>}
    </span>
  );
}

function round(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(Math.abs(n) < 1 ? 2 : 1);
}

/** A labelled figure with its own "why?" affordance. Used across every surface. */
export function Metric({
  label,
  value,
  sub,
  explainTitle,
  explain,
  strong,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  explainTitle?: string;
  explain?: ReactNode;
  strong?: boolean;
}) {
  return (
    <span className="metric">
      <span className="metric-label">
        {label}
        {explain && (
          <Explain title={explainTitle ?? label} label="?" width={330}>
            {explain}
          </Explain>
        )}
      </span>
      <span className={`metric-value ${strong ? "strong" : ""}`}>{value}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </span>
  );
}
