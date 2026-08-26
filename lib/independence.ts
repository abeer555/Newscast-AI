/**
 * Source independence.
 *
 * Ten outlets running the same AP dispatch is one piece of evidence, not ten.
 * Every trust signal in this app therefore counts *independent reporting chains*
 * rather than outlet logos. This module works out, for a set of articles about
 * one story, who did original reporting, who ran a wire copy, and how many
 * genuinely separate chains exist.
 *
 * Three signals, in order of reliability:
 *   1. Byline agency attribution — "The Associated Press", "Reuters",
 *      "Guardian staff and agencies". Strongest signal when present.
 *   2. The outlet is itself a wire service (sources.lean === 'wire').
 *   3. Body-text near-duplication across outlets — catches syndication where the
 *      feed strips the byline, which is common (BBC, DW, The Hindu and others
 *      publish no author field at all).
 */

export type Originality =
  | "original" // the outlet's own reporting
  | "wire_origin" // this outlet IS the agency (AP, Reuters)
  | "syndicated" // a wire dispatch republished under the agency's byline
  | "mixed" // own staff plus agency material ("staff and agencies")
  | "unattributed"; // no byline in the feed — provenance unstated

export interface ArticleLike {
  id: string;
  source_id: string;
  source_name: string;
  lean?: string | null;
  author?: string | null;
  published_at: number;
  title?: string | null;
  summary?: string | null;
}

export interface ArticleProvenance {
  article_id: string;
  source_id: string;
  source_name: string;
  published_at: number;
  originality: Originality;
  /** Canonical reporting chain this article belongs to. Copies share a key. */
  chain: string;
  /** Display name of the chain, e.g. "Associated Press" or "The Guardian". */
  chain_label: string;
  /** Wire agency credited, when one is. */
  agency: string | null;
  /** Plain-English justification for the classification. */
  basis: string;
  /** True when this is the earliest article in its chain. */
  chain_origin: boolean;
}

export interface IndependenceReport {
  articles: ArticleProvenance[];
  outlets: number;
  /** Distinct independent reporting chains. */
  independent: number;
  /** Chains where provenance was verified from a byline, not assumed. */
  attributed: number;
  /** Outlets whose copy traces to another chain. */
  syndicated_copies: number;
  chains: ChainSummary[];
  /** Outlet that published first overall. */
  broke_first: { source_name: string; published_at: number; chain_label: string } | null;
  summary: string;
}

export interface ChainSummary {
  chain: string;
  label: string;
  kind: "newsroom" | "agency";
  /** Outlets carrying this chain's material. */
  outlets: string[];
  article_ids: string[];
  first_published: number;
  /** True when at least one article in the chain states its provenance. */
  attributed: boolean;
}

/* ------------------------------------------------------------------ */

interface AgencyDef {
  key: string;
  label: string;
  patterns: RegExp[];
}

/**
 * Wire services and news agencies. Matched against the byline, so this list is
 * about *who supplied the copy*, which is a different question from whether an
 * outlet is reputable — the old implementation conflated the two and treated a
 * Guardian or NPR staff story as non-original.
 */
const AGENCIES: AgencyDef[] = [
  { key: "ap", label: "Associated Press", patterns: [/\bassociated press\b/i, /\bap news\b/i, /^\s*ap\s*$/i, /\(ap\)/i] },
  { key: "reuters", label: "Reuters", patterns: [/\breuters\b/i] },
  { key: "afp", label: "Agence France-Presse", patterns: [/agence france[-\s]?presse/i, /\bafp\b/i] },
  { key: "pti", label: "Press Trust of India", patterns: [/press trust of india/i, /\bpti\b/i] },
  { key: "ians", label: "IANS", patterns: [/indo[-\s]?asian news service/i, /\bians\b/i] },
  { key: "ani", label: "ANI", patterns: [/asian news international/i, /\bani\b/i] },
  { key: "bloomberg", label: "Bloomberg", patterns: [/\bbloomberg\b/i] },
  { key: "dpa", label: "dpa", patterns: [/deutsche presse[-\s]?agentur/i, /\bdpa\b/i] },
  { key: "upi", label: "UPI", patterns: [/united press international/i, /\bupi\b/i] },
  { key: "pa", label: "PA Media", patterns: [/\bpa media\b/i, /press association/i] },
  { key: "xinhua", label: "Xinhua", patterns: [/\bxinhua\b/i] },
  { key: "kyodo", label: "Kyodo", patterns: [/\bkyodo\b/i] },
  { key: "yonhap", label: "Yonhap", patterns: [/\byonhap\b/i] },
  { key: "efe", label: "EFE", patterns: [/\bagencia efe\b/i] },
  { key: "tass", label: "TASS", patterns: [/\btass\b/i] },
  { key: "anadolu", label: "Anadolu", patterns: [/\banadolu\b/i] },
];

/** Outlets that are themselves wire services, keyed by source id. */
const SOURCE_IS_AGENCY: Record<string, string> = { ap: "ap" };

const AGENCY_HINT = /\b(and|with|plus)\s+agenc(y|ies)\b|\bagenc(y|ies)\b|\bnews\s+agencies\b|\bwire\s+services?\b/i;

export function detectAgency(byline: string | null | undefined): { key: string; label: string } | null {
  if (!byline) return null;
  for (const a of AGENCIES) {
    if (a.patterns.some((p) => p.test(byline))) return { key: a.key, label: a.label };
  }
  return null;
}

/** "Guardian staff and agencies" — own reporting supplemented by wire copy. */
export function mentionsAgencies(byline: string | null | undefined): boolean {
  return !!byline && AGENCY_HINT.test(byline);
}

/* ---------- body-text near-duplicate detection ---------- */

function wordShingles(text: string, n = 8): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const out = new Set<string>();
  if (words.length < n) {
    if (words.length) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Threshold above which two articles from different outlets are the same copy. */
const DUPLICATE_TEXT_SIM = 0.5;

/* ------------------------------------------------------------------ */

export function analyzeIndependence(articles: ArticleLike[]): IndependenceReport {
  if (!articles.length) {
    return {
      articles: [],
      outlets: 0,
      independent: 0,
      attributed: 0,
      syndicated_copies: 0,
      chains: [],
      broke_first: null,
      summary: "No coverage yet.",
    };
  }

  const sorted = [...articles].sort((a, b) => a.published_at - b.published_at);

  // Pass 1: byline / wire-service classification.
  interface Draft extends ArticleProvenance {
    _text: Set<string>;
  }
  const drafts: Draft[] = sorted.map((a) => {
    const selfAgency = SOURCE_IS_AGENCY[a.source_id] ?? (a.lean === "wire" ? a.source_id : null);
    const credited = detectAgency(a.author);
    const text = wordShingles(`${a.title ?? ""} ${a.summary ?? ""}`);

    if (selfAgency) {
      const label = AGENCIES.find((x) => x.key === selfAgency)?.label ?? a.source_name;
      return {
        article_id: a.id,
        source_id: a.source_id,
        source_name: a.source_name,
        published_at: a.published_at,
        originality: "wire_origin",
        chain: `agency:${selfAgency}`,
        chain_label: label,
        agency: label,
        basis: `${a.source_name} is a wire service — this is the originating dispatch.`,
        chain_origin: false,
        _text: text,
      };
    }
    if (credited) {
      // A wire byline on a non-wire outlet means republished copy. If the outlet
      // also credits its own staff it is mixed rather than pure syndication.
      const ownStaff = /\bstaff\b/i.test(a.author ?? "") || /\bcorrespondent\b/i.test(a.author ?? "");
      return {
        article_id: a.id,
        source_id: a.source_id,
        source_name: a.source_name,
        published_at: a.published_at,
        originality: ownStaff ? "mixed" : "syndicated",
        chain: `agency:${credited.key}`,
        chain_label: credited.label,
        agency: credited.label,
        basis: ownStaff
          ? `Byline credits ${a.source_name} staff alongside ${credited.label} — partly own reporting.`
          : `Byline credits ${credited.label}, so this is a wire dispatch rather than ${a.source_name} reporting.`,
        chain_origin: false,
        _text: text,
      };
    }
    if (mentionsAgencies(a.author)) {
      return {
        article_id: a.id,
        source_id: a.source_id,
        source_name: a.source_name,
        published_at: a.published_at,
        originality: "mixed",
        chain: `outlet:${a.source_id}`,
        chain_label: a.source_name,
        agency: null,
        basis: `Byline is "${a.author}" — own staff supplemented by unnamed agency copy.`,
        chain_origin: false,
        _text: text,
      };
    }
    if (a.author && a.author.trim()) {
      return {
        article_id: a.id,
        source_id: a.source_id,
        source_name: a.source_name,
        published_at: a.published_at,
        originality: "original",
        chain: `outlet:${a.source_id}`,
        chain_label: a.source_name,
        agency: null,
        basis: `Bylined to ${a.author} at ${a.source_name} — original reporting.`,
        chain_origin: false,
        _text: text,
      };
    }
    return {
      article_id: a.id,
      source_id: a.source_id,
      source_name: a.source_name,
      published_at: a.published_at,
      originality: "unattributed",
      chain: `outlet:${a.source_id}`,
      chain_label: a.source_name,
      agency: null,
      basis: `${a.source_name} publishes no byline in its feed, so provenance is unstated. Counted as its own chain unless the text matches another outlet's copy.`,
      chain_origin: false,
      _text: text,
    };
  });

  // Pass 2: collapse near-identical text across different outlets into one
  // chain. This is what catches unbylined syndication.
  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      const a = drafts[i];
      const b = drafts[j];
      if (a.source_id === b.source_id) continue;
      if (a.chain === b.chain) continue;
      const sim = jaccard(a._text, b._text);
      if (sim < DUPLICATE_TEXT_SIM) continue;
      // Earlier article wins; if one side is already an agency chain, that wins.
      const aIsAgency = a.chain.startsWith("agency:");
      const bIsAgency = b.chain.startsWith("agency:");
      const winner = aIsAgency && !bIsAgency ? a : bIsAgency && !aIsAgency ? b : a;
      const loser = winner === a ? b : a;
      const pct = Math.round(sim * 100);
      loser.chain = winner.chain;
      loser.chain_label = winner.chain_label;
      loser.agency = winner.agency;
      if (loser.originality === "unattributed" || loser.originality === "original") loser.originality = "syndicated";
      loser.basis = `Text is ${pct}% identical to ${winner.source_name}'s copy, so it is the same report rather than independent confirmation.`;
    }
  }

  // Pass 3: chain summaries.
  const chainMap = new Map<string, ChainSummary>();
  for (const d of drafts) {
    let c = chainMap.get(d.chain);
    if (!c) {
      c = {
        chain: d.chain,
        label: d.chain_label,
        kind: d.chain.startsWith("agency:") ? "agency" : "newsroom",
        outlets: [],
        article_ids: [],
        first_published: d.published_at,
        attributed: false,
      };
      chainMap.set(d.chain, c);
    }
    if (!c.outlets.includes(d.source_name)) c.outlets.push(d.source_name);
    c.article_ids.push(d.article_id);
    c.first_published = Math.min(c.first_published, d.published_at);
    if (d.originality !== "unattributed") c.attributed = true;
  }
  for (const c of chainMap.values()) {
    const first = drafts.find((d) => d.chain === c.chain && d.published_at === c.first_published);
    if (first) first.chain_origin = true;
  }

  const outlets = new Set(drafts.map((d) => d.source_id)).size;
  const independent = chainMap.size;
  const syndicated = Math.max(0, outlets - independent);
  const chains = [...chainMap.values()].sort((a, b) => a.first_published - b.first_published);
  const attributed = chains.filter((c) => c.attributed).length;
  const firstDraft = drafts[0];

  const bits = [`${outlets} ${outlets === 1 ? "outlet" : "outlets"}`, `${independent} independent ${independent === 1 ? "reporting chain" : "reporting chains"}`];
  if (syndicated > 0) bits.push(`${syndicated} syndicated ${syndicated === 1 ? "copy" : "copies"}`);

  return {
    articles: drafts.map(({ _text, ...rest }) => rest),
    outlets,
    independent,
    attributed,
    syndicated_copies: syndicated,
    chains,
    broke_first: firstDraft
      ? { source_name: firstDraft.source_name, published_at: firstDraft.published_at, chain_label: firstDraft.chain_label }
      : null,
    summary: bits.join(", "),
  };
}

export const ORIGINALITY_LABEL: Record<Originality, string> = {
  original: "Original reporting",
  wire_origin: "Wire originator",
  syndicated: "Syndicated copy",
  mixed: "Staff + agency",
  unattributed: "Byline not stated",
};

export const INDEPENDENCE_METHOD =
  "Independent reporting chains, not outlet count. Articles are grouped into chains using byline agency attribution (a Reuters byline on another outlet is a republished dispatch), whether the outlet is itself a wire service, and near-identical body text across outlets. Ten papers running one AP dispatch counts as one chain.";
