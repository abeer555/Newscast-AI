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
};

const DEMO_EPOCH = Date.now();
const GLOBAL_CLUSTER_ID = "gaza-policy-shift";
const INDIA_CLUSTER_ID = "india-market-watch";
const GLOBAL_EPISODE_ID = "bd8bc5d60e01f616";

function readStoryboard(): { style: string; aspect: string; beats: DemoBeat[]; total_duration: number } {
  const storyboardPath = path.join(process.cwd(), "data", "logs", "storyboard_bd8bc5d60e01f616.json");
  try {
    const raw = fs.readFileSync(storyboardPath, "utf8");
    return JSON.parse(raw) as { style: string; aspect: string; beats: DemoBeat[]; total_duration: number };
  } catch {
    return {
      style: "cinematic editorial news illustration",
      aspect: "16:9",
      total_duration: 117,
      beats: [
        { index: 0, image_prompt: "newsroom anchor desk", negative_prompt: "text", caption: "Briefing begins", duration: 11.7, segment_range: [0, 0] },
      ],
    };
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

  const globalFacts = [
    {
      id: "fact-gaza-1",
      claim: "Multiple outlets describe the proposal as a phased ceasefire framework rather than a finalized treaty.",
      status: "confirmed",
      support_count: 4,
      attestation_json: JSON.stringify([
        { source: "AP", attestations: 3, url: "https://apnews.com/", original: true },
        { source: "BBC", attestations: 2, url: "https://www.bbc.com/news", original: true },
      ]),
      canonical_origins: JSON.stringify(["AP", "BBC"]),
      contradicted_by: null,
      confidence: 0.94,
      first_seen: now - 5 * 60 * 60 * 1000,
      last_seen: now - 60 * 60 * 1000,
    },
    {
      id: "fact-gaza-2",
      claim: "The hardest open question is how verification and disarmament would work on the ground.",
      status: "reported",
      support_count: 3,
      attestation_json: JSON.stringify([
        { source: "Al Jazeera", attestations: 2, url: "https://www.aljazeera.com/news", original: true },
        { source: "Guardian", attestations: 1, url: "https://www.theguardian.com/world", original: true },
      ]),
      canonical_origins: JSON.stringify(["Al Jazeera", "Guardian"]),
      contradicted_by: null,
      confidence: 0.82,
      first_seen: now - 4 * 60 * 60 * 1000,
      last_seen: now - 90 * 60 * 1000,
    },
  ];

  const indiaFacts = [
    {
      id: "fact-india-1",
      claim: "Market coverage is centered on policy expectations rather than a single earnings shock.",
      status: "confirmed",
      support_count: 3,
      attestation_json: JSON.stringify([
        { source: "The Hindu", attestations: 1, url: "https://www.thehindu.com/", original: true },
        { source: "NDTV", attestations: 1, url: "https://www.ndtv.com/", original: true },
      ]),
      canonical_origins: JSON.stringify(["The Hindu", "NDTV"]),
      contradicted_by: null,
      confidence: 0.9,
      first_seen: now - 6 * 60 * 60 * 1000,
      last_seen: now - 2 * 60 * 60 * 1000,
    },
  ];

  const tx = db.transaction(() => {
    const insertSourceArticle = db.prepare("INSERT INTO articles (id, source_id, title, summary, content, url, author, image_url, published_at, fetched_at, language) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const insertCluster = db.prepare("INSERT INTO clusters (id, title, canonical_article_id, category, topics, entities, trend_score, velocity, first_seen, last_updated, intelligence, intelligence_at, pipeline_stage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insertClusterArticle = db.prepare("INSERT INTO cluster_articles (cluster_id, article_id, similarity) VALUES (?,?,?)");
    const insertEpisode = db.prepare("INSERT INTO episodes (id, cluster_id, title, format, language, style, status, progress, stage_label, script, script_model, script_hash, audio_path, audio_duration, audio_segments, storyboard, video_path, video_duration, video_status, video_error, video_mode, evaluation, play_count, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insertFact = db.prepare("INSERT INTO cluster_facts (id, cluster_id, claim, claim_hash, status, support_count, attestation_json, canonical_origins, contradicted_by, confidence, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    const insertLiving = db.prepare("INSERT INTO living_story (cluster_id, current_summary, current_summary_at, version, timeline, last_fused_at) VALUES (?,?,?,?,?,?)");
    const insertEditorial = db.prepare("INSERT INTO editorials (cluster_id, bias_json, whats_solid, whats_contested, whats_unknown, updated_at) VALUES (?,?,?,?,?,?)");
    const insertGate = db.prepare("INSERT INTO publish_gates (episode_id, score, verdict, reasons, decided_at) VALUES (?,?,?,?,?)");
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
    for (const fact of globalFacts) insertFact.run(fact.id, GLOBAL_CLUSTER_ID, fact.claim, `${GLOBAL_CLUSTER_ID}:${fact.id}`, fact.status, fact.support_count, fact.attestation_json, fact.canonical_origins, fact.contradicted_by, fact.confidence, fact.first_seen, fact.last_seen);
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
    for (const fact of indiaFacts) insertFact.run(fact.id, INDIA_CLUSTER_ID, fact.claim, `${INDIA_CLUSTER_ID}:${fact.id}`, fact.status, fact.support_count, fact.attestation_json, fact.canonical_origins, fact.contradicted_by, fact.confidence, fact.first_seen, fact.last_seen);
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

    insertGate.run(GLOBAL_EPISODE_ID, 0.91, "publish", JSON.stringify(["Seeded demo publish gate"]), now - 90 * 60 * 1000);
    insertAnalytics.run("llm_call", "openai/gpt-oss-120b", 1520, 810, 1240, JSON.stringify({ episodeId: GLOBAL_EPISODE_ID }), now - 95 * 60 * 1000);
    insertAnalytics.run("tts_call", "kokoro/af_heart", 0, 0, 680, JSON.stringify({ chars: 4200, episodeId: GLOBAL_EPISODE_ID }), now - 94 * 60 * 1000);
    insertAnalytics.run("cluster", null, 0, 0, 210, JSON.stringify({ clusterId: GLOBAL_CLUSTER_ID }), now - 93 * 60 * 1000);
  });

  tx();
}