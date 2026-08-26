import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

type DemoBeat = {
  index: number;
  image_prompt: string;
  negative_prompt: string;
  caption: string;
  duration: number;
  segment_range: [number, number];
  /** Provenance of the frame. The seeded video was rendered locally from prompts,
   *  so every frame of it is a generated illustration and is labelled as one. */
  image_source: "ai_generated" | "article";
};

const DEMO_EPOCH = Date.now();
const GLOBAL_CLUSTER_ID = "gaza-policy-shift";
const INDIA_CLUSTER_ID = "india-market-watch";
const GLOBAL_EPISODE_ID = "bd8bc5d60e01f616";

function readStoryboard(): { style: string; aspect: string; beats: DemoBeat[]; total_duration: number } {
  const storyboardPath = path.join(process.cwd(), "data", "logs", "storyboard_bd8bc5d60e01f616.json");
  const fallback = {
    style: "cinematic editorial news illustration",
    aspect: "16:9",
    total_duration: 117,
    beats: [
      {
        index: 0,
        image_prompt: "newsroom anchor desk",
        negative_prompt: "text",
        caption: "Briefing begins",
        duration: 11.7,
        segment_range: [0, 0] as [number, number],
        image_source: "ai_generated" as const,
      },
    ],
  };
  try {
    const raw = fs.readFileSync(storyboardPath, "utf8");
    const board = JSON.parse(raw) as { style: string; aspect: string; beats: DemoBeat[]; total_duration: number };
    // The stored board predates provenance tracking. Stamping it here is not a guess:
    // this episode was rendered in "local" mode, which draws every frame from a prompt.
    return { ...board, beats: (board.beats ?? []).map((b) => ({ ...b, image_source: "ai_generated" as const })) };
  } catch {
    return fallback;
  }
}

export function seedDemoData(db: Database.Database) {
  // Only seed demo data if explicitly enabled via environment variable
  if (process.env.SEED_DEMO !== "true") return;
  
  const counts = db.prepare("SELECT COUNT(*) c FROM clusters").get() as { c: number };
  if (counts.c > 0) return;

  const now = DEMO_EPOCH;
  const storyboard = readStoryboard();

  const globalArticleIds = ["demo-ap-gaza", "demo-bbc-gaza", "demo-aljazeera-gaza", "demo-guardian-gaza"];
  const globalArticles = [
    {
      id: globalArticleIds[0], source_id: "ap", title: "AP: Global pressure builds around Gaza ceasefire blueprint", summary: "Diplomatic capitals are weighing a 15-point proposal that ties security guarantees to a phased pause in fighting.", url: "https://apnews.com/", author: "AP Newsroom", image_url: "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1200&q=80", published_at: now - 6 * 60 * 60 * 1000,
    },
    {
      id: globalArticleIds[1], source_id: "bbc", title: "BBC: Middle East allies split over the Gaza framework", summary: "Regional partners broadly welcome talks but disagree on sequencing, verification, and the role of outside guarantors.", url: "https://www.bbc.com/news", author: "BBC World", image_url: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=80", published_at: now - 5 * 60 * 60 * 1000,
    },
    {
      id: globalArticleIds[2], source_id: "aljazeera", title: "Al Jazeera: Humanitarian groups warn ceasefire details remain vague", summary: "Aid groups say the broad political outline leaves key implementation questions unresolved.", url: "https://www.aljazeera.com/news", author: "Al Jazeera English", image_url: "https://images.unsplash.com/photo-1500673922987-e212871fec22?auto=format&fit=crop&w=1200&q=80", published_at: now - 4 * 60 * 60 * 1000,
    },
    {
      id: globalArticleIds[3], source_id: "guardian", title: "Guardian: Diplomats test the plan against public opinion and security concerns", summary: "Commentary focuses on whether a temporary deal can turn into a durable settlement or simply pause escalation.", url: "https://www.theguardian.com/world", author: "Guardian Staff", image_url: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80", published_at: now - 3 * 60 * 60 * 1000,
    },
  ];

  const indiaArticleIds = ["demo-hindu-rates", "demo-ndtv-markets", "demo-print-budget"];
  const indiaArticles = [
    {
      id: indiaArticleIds[0], source_id: "hindu", title: "The Hindu: Investors watch for policy cues after mixed inflation data", summary: "Markets are leaning on rate-cut expectations as the latest macro prints keep the policy path in focus.", url: "https://www.thehindu.com/", author: "Business Desk", image_url: "https://images.unsplash.com/photo-1560439514-4e9645039924?auto=format&fit=crop&w=1200&q=80", published_at: now - 7 * 60 * 60 * 1000,
    },
    {
      id: indiaArticleIds[1], source_id: "ndtv", title: "NDTV: Tech and banking shares lift the India desk's tone", summary: "Coverage points to a constructive mood around domestic growth, lending, and chip-adjacent manufacturing themes.", url: "https://www.ndtv.com/", author: "NDTV Business", image_url: "https://images.unsplash.com/photo-1559526324-593bc073d938?auto=format&fit=crop&w=1200&q=80", published_at: now - 6 * 60 * 60 * 1000,
    },
    {
      id: indiaArticleIds[2], source_id: "theprint", title: "ThePrint: Budget chatter turns to capex and consumer demand", summary: "The latest reporting centers on investment spending, rural demand, and whether the market rally has room to extend.", url: "https://theprint.in/", author: "ThePrint Desk", image_url: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80", published_at: now - 5 * 60 * 60 * 1000,
    },
  ];

  const globalEpisodeScript = {
    title: "Trump's 15-point Gaza plan",
    description: "A grounded editorial briefing on the new Gaza framework, the source split, and what happens next.",
    tags: ["gaza", "ceasefire", "diplomacy"],
    hosts: [
      { name: "Mira", role: "anchor", voice: "af_heart" },
      { name: "Owen", role: "analyst", voice: "am_adam" },
    ],
    estimated_seconds: 117,
    segments: [
      { index: 0, speaker: "Mira", voice: "af_heart", direction: "serious", text: "Welcome back. The Gaza plan now moving through diplomatic channels is being treated less like a headline and more like a negotiating framework." },
      { index: 1, speaker: "Owen", voice: "am_adam", direction: "thoughtful", text: "The reporting is consistent on the broad outline: a phased pause in fighting, a hostage-prisoner exchange, and pressure on all sides to commit to verification." },
      { index: 2, speaker: "Mira", voice: "af_heart", direction: "calm", text: "AP and BBC both describe the same core tension. The plan has enough structure to attract attention, but not enough detail to settle the hard implementation questions." },
      { index: 3, speaker: "Owen", voice: "am_adam", direction: "curious", text: "That matters because the details decide whether this becomes a durable process or just another short-lived announcement cycle." },
      { index: 4, speaker: "Mira", voice: "af_heart", direction: "serious", text: "Al Jazeera's framing pushes the humanitarian gap to the front, especially the lack of clarity around aid delivery and supervision." },
      { index: 5, speaker: "Owen", voice: "am_adam", direction: "professionally", text: "Meanwhile the more hawkish coverage focuses on security guarantees and disarmament. That split is the story inside the story." },
      { index: 6, speaker: "Mira", voice: "af_heart", direction: "warm", text: "Put plainly, everyone agrees the proposal is important. They do not agree on whether it is enforceable, balanced, or politically survivable." },
      { index: 7, speaker: "Owen", voice: "am_adam", direction: "thoughtful", text: "The next signal to watch is who actually signs on, and whether regional intermediaries can turn a plan into a mechanism." },
      { index: 8, speaker: "Mira", voice: "af_heart", direction: "urgent", text: "If those guarantees do not materialize quickly, the narrative will shift from diplomacy to escalation risk." },
      { index: 9, speaker: "Owen", voice: "am_adam", direction: "calm", text: "For now, the safest read is that the plan has momentum as a talking point, but the facts on the ground still decide the outcome." },
      { index: 10, speaker: "Mira", voice: "af_heart", direction: "serious", text: "That is the briefing. We will keep tracking the sourcing, the responses, and whether the language hardens into an actual deal." },
      { index: 11, speaker: "Owen", voice: "am_adam", direction: "warm", text: "And we will keep separating what is confirmed from what is still just political theater." },
    ],
  };

  const indiaEpisodeScript = {
    title: "India market watch: policy optimism and capex chatter",
    description: "A short India desk package on markets, budget expectations, and the sectors getting the most attention.",
    tags: ["india", "markets", "economy"],
    hosts: [
      { name: "Anika", role: "anchor", voice: "af_bella" },
      { name: "Rahul", role: "analyst", voice: "am_michael" },
    ],
    estimated_seconds: 88,
    segments: [
      { index: 0, speaker: "Anika", voice: "af_bella", direction: "warm", text: "The India desk is leaning positive today, with investors watching policy cues and broader growth signals." },
      { index: 1, speaker: "Rahul", voice: "am_michael", direction: "thoughtful", text: "Inflation is not giving a dramatic surprise, which keeps rate-cut talk alive and supports the more optimistic read." },
      { index: 2, speaker: "Anika", voice: "af_bella", direction: "calm", text: "The strongest coverage themes are capex, banking, and tech, with each outlet emphasizing a slightly different piece of the cycle." },
      { index: 3, speaker: "Rahul", voice: "am_michael", direction: "professionally", text: "That means the trade is less about a single headline and more about whether the macro backdrop continues to improve." },
      { index: 4, speaker: "Anika", voice: "af_bella", direction: "serious", text: "For demo purposes, this is the same workflow your users will see on Vercel: a live story, an audio episode, and a ready-to-watch video asset." },
    ],
  };

  /* ------------------------------------------------------------------ *
   * Evidence fixtures
   *
   * These rows are shaped exactly as lib/verification.ts writes them, because the
   * dossier, the claim tiers, the inline citations, evidence-backed playback and the
   * publish gate all read the same columns. Seeding the old two-field attestation
   * shape left the demo with claims that had no reporting chains, which made every
   * tier badge read "unverified" and the gate hold a perfectly good episode.
   *
   * `chain` is the unit that matters: two outlets in the same chain are one piece of
   * reporting. The Guardian's attestation on the second claim is deliberately a
   * syndicated copy of the AP dispatch, so the demo shows three outlets resolving to
   * two independent chains rather than pretending to be triple-sourced.
   *
   * Tiers and confidences here are the values tierFor() and claimConfidence() in
   * lib/verification.ts produce for these chain counts — the reasons are quoted from
   * them verbatim so the fixture cannot drift into claiming something the documented
   * rules would not.
   * ------------------------------------------------------------------ */

  const OUTLET_NAME: Record<string, string> = {
    ap: "AP", bbc: "BBC", aljazeera: "Al Jazeera", guardian: "Guardian",
    hindu: "The Hindu", ndtv: "NDTV", theprint: "ThePrint",
  };
  const CHAIN: Record<string, { chain: string; chain_label: string; originality: string }> = {
    ap: { chain: "wire:ap", chain_label: "AP wire", originality: "wire_origin" },
    bbc: { chain: "outlet:bbc", chain_label: "BBC's own reporting", originality: "original" },
    aljazeera: { chain: "outlet:aljazeera", chain_label: "Al Jazeera's own reporting", originality: "original" },
    guardian: { chain: "outlet:guardian", chain_label: "Guardian's own reporting", originality: "original" },
    hindu: { chain: "outlet:hindu", chain_label: "The Hindu's own reporting", originality: "original" },
    ndtv: { chain: "outlet:ndtv", chain_label: "NDTV's own reporting", originality: "original" },
    theprint: { chain: "outlet:theprint", chain_label: "ThePrint's own reporting", originality: "original" },
  };
  const articleBySource = new Map([...globalArticles, ...indiaArticles].map((a) => [a.source_id, a]));

  /** One outlet's attestation of a claim, in its own words. */
  const attest = (sourceId: string, text: string, carriedFrom?: string) => {
    const article = articleBySource.get(sourceId);
    const own = CHAIN[sourceId];
    const chainOf = carriedFrom ? CHAIN[carriedFrom] : own;
    return {
      article_id: article?.id ?? `demo-${sourceId}`,
      source: OUTLET_NAME[sourceId] ?? sourceId,
      source_id: sourceId,
      url: article?.url ?? "",
      published_at: article?.published_at ?? now,
      chain: chainOf.chain,
      chain_label: chainOf.chain_label,
      // A syndicated copy belongs to the chain it came from, not to the outlet
      // that reprinted it — that is the whole point of the distinction.
      originality: carriedFrom ? "syndicated" : own.originality,
      text,
    };
  };

  type DemoAttestation = ReturnType<typeof attest>;

  const TIER_REASON: Record<string, string> = {
    confirmed_4: "Reported independently by 4 separate reporting chains, so it does not rest on any single newsroom's account.",
    confirmed_3: "Reported independently by 3 separate reporting chains, so it does not rest on any single newsroom's account.",
    corroborated: "Two independent newsrooms report this. Corroborated, but one short of the three-chain bar for confirmation.",
    reported_1: "Single reporting chain.",
    reported_syndicated: "Single reporting chain. 2 outlets carry it, but they trace to one original report, so the extra outlets add reach rather than evidence.",
    disputed: "Another outlet in this story asserts the opposite, or gives a conflicting figure. Both versions are shown rather than one being picked.",
  };

  const fact = (
    id: string,
    claim: string,
    tier: "confirmed" | "corroborated" | "reported" | "disputed",
    tierReason: string,
    confidence: number,
    topic: string,
    atts: DemoAttestation[],
    contradicts?: string[],
  ) => {
    const chains = [...new Set(atts.map((a) => a.chain))];
    const outlets = [...new Set(atts.map((a) => a.source_id))];
    const sorted = [...atts].sort((a, b) => a.published_at - b.published_at);
    return {
      id,
      claim,
      // The legacy status column is kept in step with the tier for older readers.
      status: tier === "corroborated" ? "reported" : tier,
      tier,
      tier_reason: tierReason,
      support_count: atts.length,
      outlet_count: outlets.length,
      independent_count: chains.length,
      attestation_json: JSON.stringify(sorted),
      canonical_origins: JSON.stringify([...new Set(sorted.map((a) => a.chain_label))]),
      contradicted_by: contradicts?.length ? JSON.stringify(contradicts) : null,
      confidence,
      topic,
      first_reported_by: sorted[0]?.source ?? null,
      first_reported_at: sorted[0]?.published_at ?? null,
      variants_json: JSON.stringify(
        [...new Map(sorted.map((a) => [a.chain, { source: a.source, chain: a.chain_label, text: a.text }])).values()],
      ),
      first_seen: sorted[0]?.published_at ?? now - 6 * 60 * 60 * 1000,
      last_seen: now - 45 * 60 * 1000,
    };
  };

  const globalFacts = [
    fact(
      "fact-gaza-1",
      "The Gaza plan is being treated as a negotiating framework.",
      "confirmed",
      TIER_REASON.confirmed_4,
      0.99,
      "diplomacy",
      [
        attest("ap", "Officials describe the 15-point document as a negotiating framework, not a signed agreement."),
        attest("bbc", "Diplomats are treating the plan as a framework for negotiation rather than a concluded deal."),
        attest("aljazeera", "The proposal is being handled as an opening negotiating position."),
        attest("guardian", "Whitehall sources call it a negotiating framework whose details are still open."),
      ],
    ),
    fact(
      "fact-gaza-2",
      "A phased pause in fighting and a hostage-prisoner exchange are in the outline.",
      "corroborated",
      TIER_REASON.corroborated,
      0.99,
      "ceasefire terms",
      [
        attest("ap", "The outline pairs a phased pause in fighting with a hostage-prisoner exchange."),
        attest("guardian", "The outline pairs a phased pause in fighting with a hostage-prisoner exchange.", "ap"),
        attest("bbc", "BBC understands the sequencing begins with a staged halt to fighting alongside an exchange of hostages and prisoners."),
      ],
    ),
    fact(
      "fact-gaza-3",
      "The plan has enough structure to attract attention but not enough detail to settle implementation questions.",
      "confirmed",
      TIER_REASON.confirmed_3,
      0.99,
      "implementation",
      [
        attest("ap", "The document is specific on principles and thin on implementation."),
        attest("bbc", "There is structure here, but the operational detail that would make it work is missing."),
        attest("aljazeera", "The framework attracts attention precisely because the hard details are unresolved."),
      ],
    ),
    fact(
      "fact-gaza-4",
      "The details decide whether this becomes a durable process.",
      "corroborated",
      TIER_REASON.corroborated,
      0.97,
      "implementation",
      [
        attest("bbc", "Whether this becomes durable depends on details not yet written down."),
        attest("guardian", "Analysts say the detail, not the announcement, decides whether the process lasts."),
      ],
    ),
    fact(
      "fact-gaza-5",
      "There is a lack of clarity around aid delivery and supervision.",
      "confirmed",
      TIER_REASON.confirmed_3,
      0.99,
      "humanitarian",
      [
        attest("aljazeera", "Aid agencies say delivery routes and supervision are undefined."),
        attest("guardian", "Humanitarian groups cannot see who would supervise aid delivery under the plan."),
        attest("bbc", "The plan does not specify how aid would be delivered or monitored."),
      ],
    ),
    fact(
      "fact-gaza-6",
      "Hawkish coverage focuses on security guarantees and disarmament.",
      "corroborated",
      TIER_REASON.corroborated,
      0.97,
      "security",
      [
        attest("ap", "Security guarantees and disarmament dominate the more hawkish commentary."),
        attest("guardian", "Hawkish readings of the plan centre on disarmament and security guarantees."),
      ],
    ),
    fact(
      "fact-gaza-7",
      "Outlets do not agree on whether it is enforceable, balanced, or politically survivable.",
      "confirmed",
      TIER_REASON.confirmed_3,
      0.99,
      "assessment",
      [
        attest("bbc", "Assessments diverge on enforceability and political survivability."),
        attest("aljazeera", "Commentators disagree on whether the plan is balanced."),
        attest("guardian", "There is no agreement on whether the plan can be enforced or survive politically."),
      ],
    ),
    fact(
      "fact-gaza-8",
      "Regional intermediaries could turn the plan into a mechanism.",
      "corroborated",
      TIER_REASON.corroborated,
      0.97,
      "diplomacy",
      [
        attest("ap", "Regional intermediaries are the route from plan to mechanism."),
        attest("bbc", "Mediators in the region would have to convert the plan into a working mechanism."),
      ],
    ),
    fact(
      "fact-gaza-9",
      "If guarantees do not materialize the narrative will shift from diplomacy to escalation risk.",
      "reported",
      TIER_REASON.reported_1,
      0.52,
      "risk",
      [attest("guardian", "Absent firm guarantees, the story returns to escalation risk within weeks.")],
    ),
    fact(
      "fact-gaza-10",
      "Israeli officials have accepted the verification mechanism in principle.",
      "disputed",
      TIER_REASON.disputed,
      0.52,
      "verification",
      [attest("ap", "Israeli officials have signalled acceptance of the verification mechanism in principle.")],
      ["fact-gaza-11"],
    ),
    fact(
      "fact-gaza-11",
      "Israeli officials have not agreed to any verification mechanism.",
      "disputed",
      TIER_REASON.disputed,
      0.52,
      "verification",
      [attest("aljazeera", "Israeli officials deny agreeing to a verification mechanism at this stage.")],
      ["fact-gaza-10"],
    ),
  ];

  const indiaFacts = [
    fact(
      "fact-india-1",
      "Investors are watching policy cues and broader growth signals.",
      "confirmed",
      TIER_REASON.confirmed_3,
      0.99,
      "policy",
      [
        attest("hindu", "Investors are focused on policy cues rather than a single earnings print."),
        attest("ndtv", "The market is trading on growth signals and policy expectations."),
        attest("theprint", "Attention is on the policy path and the broader growth picture."),
      ],
    ),
    fact(
      "fact-india-2",
      "Inflation is not giving a dramatic surprise, which keeps rate-cut talk alive.",
      "corroborated",
      TIER_REASON.corroborated,
      0.97,
      "inflation",
      [
        attest("hindu", "The inflation print held close to expectations, keeping rate-cut hopes intact."),
        attest("ndtv", "No inflation shock means the rate-cut conversation continues."),
      ],
    ),
    fact(
      "fact-india-3",
      "The strongest coverage themes are capex, banking, and tech.",
      "corroborated",
      TIER_REASON.corroborated,
      0.97,
      "sectors",
      [
        attest("ndtv", "Banking and tech led the tape, with capex the recurring theme."),
        attest("theprint", "Capex, lenders and technology dominate the coverage."),
      ],
    ),
    fact(
      "fact-india-4",
      "The trade is less about a single headline and more about the macro backdrop.",
      "corroborated",
      TIER_REASON.corroborated,
      0.97,
      "macro",
      [
        attest("theprint", "This is a macro trade, not a headline trade."),
        attest("hindu", "The move reflects the macro backdrop rather than any one announcement."),
      ],
    ),
  ];

  const tx = db.transaction(() => {
    const insertSourceArticle = db.prepare("INSERT INTO articles (id, source_id, title, summary, content, url, author, image_url, published_at, fetched_at, language) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const insertCluster = db.prepare("INSERT INTO clusters (id, title, canonical_article_id, category, topics, entities, trend_score, velocity, first_seen, last_updated, intelligence, intelligence_at, pipeline_stage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insertClusterArticle = db.prepare("INSERT INTO cluster_articles (cluster_id, article_id, similarity) VALUES (?,?,?)");
    const insertEpisode = db.prepare("INSERT INTO episodes (id, cluster_id, title, format, language, style, status, progress, stage_label, script, script_model, script_hash, audio_path, audio_duration, audio_segments, storyboard, video_path, video_duration, video_status, video_error, video_mode, evaluation, play_count, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    // Seeding runs from migrate() immediately after the additive migrations, so the
    // evidence columns are guaranteed to exist by the time this statement is prepared.
    const insertFact = db.prepare(
      "INSERT INTO cluster_facts (id, cluster_id, claim, claim_hash, status, tier, tier_reason, support_count, outlet_count, independent_count, attestation_json, canonical_origins, contradicted_by, confidence, topic, first_reported_by, first_reported_at, variants_json, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const runFact = (clusterId: string, f: (typeof globalFacts)[number]) =>
      insertFact.run(
        f.id, clusterId, f.claim, `${clusterId}:${f.id}`, f.status, f.tier, f.tier_reason,
        f.support_count, f.outlet_count, f.independent_count, f.attestation_json, f.canonical_origins,
        f.contradicted_by, f.confidence, f.topic, f.first_reported_by, f.first_reported_at,
        f.variants_json, f.first_seen, f.last_seen,
      );
    const insertLiving = db.prepare("INSERT INTO living_story (cluster_id, current_summary, current_summary_at, version, timeline, last_fused_at) VALUES (?,?,?,?,?,?)");
    const insertEditorial = db.prepare("INSERT INTO editorials (cluster_id, bias_json, whats_solid, whats_contested, whats_unknown, updated_at) VALUES (?,?,?,?,?,?)");
    // No seeded publish_gates row: the gate is computed from the stored evidence by
    // lib/gates.ts on demand, and a hardcoded verdict here would be a claim the
    // arithmetic had not actually made.
    const insertAnalytics = db.prepare("INSERT INTO analytics_events (kind, model, tokens_prompt, tokens_completion, latency_ms, meta, created_at) VALUES (?,?,?,?,?,?,?)");

    for (const article of globalArticles) {
      insertSourceArticle.run(article.id, article.source_id, article.title, article.summary, null, article.url, article.author, article.image_url, article.published_at, article.published_at, "en");
    }
    insertCluster.run(
      GLOBAL_CLUSTER_ID,
      "Trump's 15-point Gaza plan sparks global pushback",
      globalArticleIds[0],
      "conflict",
      JSON.stringify(["gaza", "ceasefire", "diplomacy", "middle east"]),
      JSON.stringify([
        { name: "Trump", type: "person" },
        { name: "Gaza", type: "place" },
        { name: "United States", type: "org" },
        { name: "Israel", type: "org" },
      ]),
      92.4,
      8.8,
      now - 7 * 60 * 60 * 1000,
      now - 40 * 60 * 1000,
      JSON.stringify({
        headline: "Trump's 15-point Gaza plan sparks global pushback",
        lede: "A sharply framed Gaza proposal is moving through diplomacy as outlets split on whether it is a workable ceasefire path or just a political opening bid.",
        summary_long: "The latest coverage treats the proposal as a live diplomatic framework rather than a closed deal. The reporting converges on the same basic architecture, but divides on whether verification, humanitarian relief, and disarmament can be squared quickly enough to matter.",
        category: "conflict",
        importance: 93,
        sentiment: -0.35,
        key_facts: [
          { fact: "The proposal is being discussed as a phased framework.", confidence: "confirmed" },
          { fact: "Verification and sequencing remain the main bottlenecks.", confidence: "reported" },
        ],
        entities: [
          { name: "Trump", type: "person" },
          { name: "Netanyahu", type: "person" },
          { name: "Gaza", type: "place" },
          { name: "AP", type: "org" },
        ],
        why_it_matters: "The proposal could become the first concrete diplomatic baseline in weeks, but only if the verification and humanitarian details hold together.",
        what_next: "Watch for regional mediator statements, formal acceptance language, and any signs that the security provisions are being reworked.",
        framing: [
          { source: "AP", lean: "wire", headline: "Plan gains traction in diplomatic circles", framing: "The wire framing stresses procedural momentum and what officials are saying behind closed doors.", emphasis: ["diplomacy", "process"], tone: "neutral", omits: "The broader humanitarian cost." },
          { source: "BBC", lean: "center", headline: "Allies split over feasibility", framing: "BBC's framing is more balanced, emphasizing both the proposal and the implementation dispute.", emphasis: ["feasibility", "allies"], tone: "cautious", omits: "The most forceful security language." },
          { source: "Al Jazeera", lean: "center-left", headline: "Humanitarian gap remains unresolved", framing: "The coverage foregrounds aid access, accountability, and the lack of operational detail.", emphasis: ["aid", "humanitarian"], tone: "critical", omits: "The more optimistic diplomatic read." },
          { source: "Guardian", lean: "center-left", headline: "Can a plan survive public and political pressure?", framing: "The Guardian angle treats the proposal as a stress test for all sides, especially at home.", emphasis: ["politics", "pressure"], tone: "cautious", omits: "The short-term tactical gains." },
        ],
        consensus: ["All outlets treat the proposal as politically significant.", "No outlet presents it as a final deal yet."],
        disagreements: ["How enforceable the framework is.", "Whether security or humanitarian issues should lead."],
        timeline: [
          { time: "08:00", event: "The proposal is circulated to allies and press reports begin to converge.", source_ids: ["ap", "bbc"] },
          { time: "10:30", event: "Humanitarian groups question the operational specifics.", source_ids: ["aljazeera"] },
          { time: "13:15", event: "Regional capitals push for clarification and verification language.", source_ids: ["guardian"] },
        ],
        podcast_angle: "Treat the story as a live diplomatic draft, not a settled outcome. The hook is the gap between a framework on paper and the mechanics needed to make it real.",
      }),
      now - 40 * 60 * 1000,
      "analyzed"
    );
    for (const article of globalArticles) insertClusterArticle.run(GLOBAL_CLUSTER_ID, article.id, article.id === globalArticleIds[0] ? 1 : 0.88);
    for (const fact of globalFacts) runFact(GLOBAL_CLUSTER_ID, fact);
    insertLiving.run(
      GLOBAL_CLUSTER_ID,
      "A diplomatic framework is circulating, but the crucial work remains in the verification and implementation details. Every outlet agrees the moment matters; they diverge on whether the plan can survive first contact with the facts on the ground.",
      now - 35 * 60 * 1000,
      3,
      JSON.stringify([
        { t: "08:00", event: "Framework enters circulation.", source_ids: ["ap", "bbc"] },
        { t: "10:30", event: "Humanitarian concerns sharpen.", source_ids: ["aljazeera"] },
        { t: "13:15", event: "Regional players ask for specifics.", source_ids: ["guardian"] },
      ]),
      now - 20 * 60 * 1000,
    );
    insertEditorial.run(
      GLOBAL_CLUSTER_ID,
      JSON.stringify({ ap: 0.9, bbc: 0.8, aljazeera: 0.75, guardian: 0.78 }),
      JSON.stringify(["A ceasefire framework is live and widely covered.", "Security and humanitarian consequences are both central."]),
      JSON.stringify(["The exact enforcement path."]),
      JSON.stringify(["Whether a deal can be signed quickly enough to matter."]),
      now - 20 * 60 * 1000,
    );

    for (const article of indiaArticles) {
      insertSourceArticle.run(article.id, article.source_id, article.title, article.summary, null, article.url, article.author, article.image_url, article.published_at, article.published_at, "en");
    }
    insertCluster.run(
      INDIA_CLUSTER_ID,
      "India market watch: policy optimism and capex chatter",
      indiaArticleIds[0],
      "business",
      JSON.stringify(["india", "markets", "economy", "policy"]),
      JSON.stringify([
        { name: "Nifty", type: "org" },
        { name: "Reserve Bank of India", type: "org" },
        { name: "India", type: "place" },
      ]),
      74.8,
      5.1,
      now - 8 * 60 * 60 * 1000,
      now - 55 * 60 * 1000,
      JSON.stringify({
        headline: "India market watch: policy optimism and capex chatter",
        lede: "The India desk is leaning constructive, with policy expectations and growth commentary driving the mood rather than a single shock headline.",
        summary_long: "Coverage from Indian outlets points to a more constructive market tone. Inflation, capex, and consumer demand are all in frame, but the dominant thread is that the macro backdrop looks steady enough to keep investors engaged.",
        category: "business",
        importance: 68,
        sentiment: 0.18,
        key_facts: [
          { fact: "Policy expectations are helping the market mood.", confidence: "confirmed" },
          { fact: "Capex and consumer demand remain the key watch items.", confidence: "reported" },
        ],
        entities: [
          { name: "Reserve Bank of India", type: "org" },
          { name: "Nifty", type: "org" },
          { name: "India", type: "place" },
        ],
        why_it_matters: "This is the kind of macro story that changes the tone of a whole dashboard, even when there is no single explosive event.",
        what_next: "Watch the next inflation read and any official remarks on liquidity or rate policy.",
        framing: [
          { source: "The Hindu", lean: "center-left", headline: "Policy cues keep the market calm", framing: "The Hindu framing is measured and macro-focused.", emphasis: ["policy", "macro"], tone: "neutral", omits: "The more speculative trading angle." },
          { source: "NDTV", lean: "center", headline: "Tech and banks lead a constructive session", framing: "NDTV keeps the story approachable with a sector lens.", emphasis: ["tech", "banks"], tone: "optimistic", omits: "The caution around global risk." },
          { source: "ThePrint", lean: "center-left", headline: "Capex and demand are the real test", framing: "ThePrint pushes into structural growth questions.", emphasis: ["capex", "demand"], tone: "cautious", omits: "The day-to-day market color." },
        ],
        consensus: ["The tone is constructive.", "Policy matters more than a single company headline."],
        disagreements: ["How quickly rate cuts could arrive.", "Whether the rally can broaden beyond large caps."],
        timeline: [
          { time: "09:15", event: "Inflation and policy chatter lift sentiment.", source_ids: ["hindu"] },
          { time: "11:20", event: "Banking and technology names outperform.", source_ids: ["ndtv"] },
          { time: "14:05", event: "Analysts focus on capex and demand sustainability.", source_ids: ["theprint"] },
        ],
        podcast_angle: "Frame it as a market-mood episode: not a hard breaking-news bulletin, but a sharp read on why the India desk is leaning upbeat.",
      }),
      now - 55 * 60 * 1000,
      "analyzed"
    );
    for (const article of indiaArticles) insertClusterArticle.run(INDIA_CLUSTER_ID, article.id, article.id === indiaArticleIds[0] ? 1 : 0.9);
    for (const fact of indiaFacts) runFact(INDIA_CLUSTER_ID, fact);
    insertLiving.run(
      INDIA_CLUSTER_ID,
      "India market coverage is treating the day as constructive, with policy expectations, capex, and demand dynamics all pointing in roughly the same direction.",
      now - 50 * 60 * 1000,
      2,
      JSON.stringify([
        { t: "09:15", event: "Policy expectations improve sentiment.", source_ids: ["hindu"] },
        { t: "11:20", event: "Tech and banks lead the tape.", source_ids: ["ndtv"] },
        { t: "14:05", event: "Capex and demand become the central question.", source_ids: ["theprint"] },
      ]),
      now - 30 * 60 * 1000,
    );

    insertEpisode.run(
      GLOBAL_EPISODE_ID,
      GLOBAL_CLUSTER_ID,
      globalEpisodeScript.title,
      "briefing",
      "en",
      "conversational",
      "ready",
      1,
      "Ready (gated publish)",
      JSON.stringify(globalEpisodeScript),
      "openai/gpt-oss-120b",
      "demo-sha1-gaza",
      "/audio/bd8bc5d60e01f616.wav",
      117,
      12,
      JSON.stringify(storyboard),
      "/video/bd8bc5d60e01f616.mp4",
      117,
      "ready",
      null,
      "local",
      JSON.stringify({
        scores: {
          accuracy: 0.92,
          balance: 0.89,
          clarity: 0.93,
          engagement: 0.87,
          naturalness: 0.94,
          syndication_handling: 0.88,
          contradiction_disclosure: 0.9,
        },
        publish_confidence: 0.91,
        decision: "publish",
        reasons: [
          "Coverage is cross-sourced across multiple outlets.",
          "The episode already has rendered audio and video assets.",
          "Story intelligence and evidence are both populated for the demo.",
        ],
        fact_check_notes: "Seeded demo content for Vercel preview.",
        improvements: ["Add one more regional source before publishing.", "Tighten the transition into the implementation section."],
        visual_relevance: 0.9,
        audio_quality: 0.94,
        subtitle_sync: 0.97,
        syndication_handling: 0.88,
        contradiction_disclosure: 0.9,
      }),
      18,
      now - 2 * 60 * 60 * 1000,
      now - 2 * 60 * 60 * 1000,
      now - 90 * 60 * 1000,
    );

    insertEpisode.run(
      "india-market-watch-episode",
      INDIA_CLUSTER_ID,
      indiaEpisodeScript.title,
      "briefing",
      "en",
      "conversational",
      "ready",
      1,
      "Ready (demo)",
      JSON.stringify(indiaEpisodeScript),
      "openai/gpt-oss-120b",
      "demo-sha1-india",
      "/audio/50f81d948debb89a.wav",
      88,
      5,
      null,
      "/video/50f81d948debb89a.mp4",
      88,
      "ready",
      null,
      "local",
      JSON.stringify({
        scores: { accuracy: 0.88, balance: 0.84, clarity: 0.9, engagement: 0.82, naturalness: 0.92 },
        publish_confidence: 0.86,
        decision: "publish",
        reasons: ["Short demo episode for the India desk.", "Useful for showing the library and studio states."],
      }),
      7,
      now - 90 * 60 * 1000,
      now - 90 * 60 * 1000,
      now - 75 * 60 * 1000,
    );

    // Both seeded stories ship with their evidence already in place, so mark them
    // verified — otherwise the dossier and the pulse would report that verification
    // has never run for stories whose claims are sitting right there.
    const markVerified = db.prepare("UPDATE clusters SET verify_status='done', verified_at=? WHERE id=?");
    markVerified.run(now - 45 * 60 * 1000, GLOBAL_CLUSTER_ID);
    markVerified.run(now - 40 * 60 * 1000, INDIA_CLUSTER_ID);

    insertAnalytics.run("llm_call", "openai/gpt-oss-120b", 1520, 810, 1240, JSON.stringify({ episodeId: GLOBAL_EPISODE_ID }), now - 95 * 60 * 1000);
    insertAnalytics.run("tts_call", "kokoro/af_heart", 0, 0, 680, JSON.stringify({ chars: 4200, episodeId: GLOBAL_EPISODE_ID }), now - 94 * 60 * 1000);
    insertAnalytics.run("cluster", null, 0, 0, 210, JSON.stringify({ clusterId: GLOBAL_CLUSTER_ID }), now - 93 * 60 * 1000);
  });

  tx();
}