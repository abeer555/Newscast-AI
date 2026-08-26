"use client";

/**
 * Timestamps.
 *
 * "4d ago" is fine for a feed and useless for a news product — a reader deciding
 * whether coverage is current needs to know *when*. These components always
 * carry the exact instant: visible where there is room, on hover and in the
 * accessible title where there is not.
 */

import { useEffect, useState } from "react";

const TZ_LABEL = "IST";

/** "26 Aug 2026, 14:32 IST" — the local newsroom timezone, stated explicitly. */
export function exactTime(ts: number | string | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  return `${date}, ${time} ${TZ_LABEL}`;
}

export function relativeTime(ts: number | string | Date, now = Date.now()): string {
  const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  if (Number.isNaN(t)) return String(ts);
  const diff = now - t;
  const future = diff < 0;
  const mins = Math.round(Math.abs(diff) / 60_000);
  let out: string;
  if (mins < 1) out = "just now";
  else if (mins < 60) out = `${mins}m`;
  else if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    out = m && h < 6 ? `${h}h ${m}m` : `${h}h`;
  } else {
    const d = Math.floor(mins / 1440);
    out = d < 14 ? `${d}d` : `${Math.floor(d / 7)}w`;
  }
  if (out === "just now") return out;
  return future ? `in ${out}` : `${out} ago`;
}

/**
 * @param mode "relative" shows "4h ago" with the exact time on hover;
 *             "exact" shows the timestamp itself; "both" shows "4h ago · 26 Aug, 14:32 IST".
 */
export function Time({
  at,
  mode = "both",
  className,
}: {
  at: number | string | null | undefined;
  mode?: "relative" | "exact" | "both";
  className?: string;
}) {
  // Rendered after mount so the server and client never disagree on "now".
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (at === null || at === undefined || at === "") return <span className={className}>—</span>;
  const ms = typeof at === "number" ? at : new Date(at).getTime();
  if (Number.isNaN(ms)) return <span className={className}>{String(at)}</span>;

  const exact = exactTime(ms);
  const rel = now === null ? "" : relativeTime(ms, now);
  const iso = new Date(ms).toISOString();

  if (mode === "exact") {
    return (
      <time className={className} dateTime={iso} title={rel ? `${rel} · ${exact}` : exact}>
        {exact}
      </time>
    );
  }
  if (mode === "relative") {
    return (
      <time className={className} dateTime={iso} title={exact}>
        {rel || exact}
      </time>
    );
  }
  return (
    <time className={className} dateTime={iso} title={exact}>
      {rel && <span>{rel}</span>}
      {rel && <span className="dim"> · </span>}
      <span className="dim">{exact}</span>
    </time>
  );
}

/** Duration in seconds → "4:07". */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
