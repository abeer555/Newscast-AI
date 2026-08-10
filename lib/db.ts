import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, "newscast.db");

const g = globalThis as unknown as { __newscastDb?: Database.Database };

export function getDb(): Database.Database {
  if (!g.__newscastDb) {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
    g.__newscastDb = db;
  }
  return g.__newscastDb;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      language TEXT DEFAULT 'en',
      lean TEXT DEFAULT 'center',
      country TEXT DEFAULT 'global',
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id),
      title TEXT NOT NULL,
      summary TEXT,
      content TEXT,
      url TEXT UNIQUE NOT NULL,
      author TEXT,
      image_url TEXT,
      published_at INTEGER NOT NULL,
      fetched_at INTEGER NOT NULL,
      language TEXT DEFAULT 'en',
      tokens TEXT,             -- JSON array of normalized tokens
      embedding TEXT           -- JSON array fingerprint vector (reserved)
    );
    CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_id);

    CREATE TABLE IF NOT EXISTS clusters (
      id TEXT PRIMARY KEY,
      title TEXT,
      canonical_article_id TEXT,
      category TEXT,
      topics TEXT,             -- JSON array
      entities TEXT,           -- JSON array
      trend_score REAL DEFAULT 0,
      velocity REAL DEFAULT 0,
      first_seen INTEGER,
      last_updated INTEGER,
      intelligence TEXT,       -- JSON deep-dive blob (StoryIntelligence)
      intelligence_at INTEGER,
      pipeline_stage TEXT DEFAULT 'raw'  -- raw | clustered | analyzed
    );

    CREATE TABLE IF NOT EXISTS cluster_articles (
      cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      similarity REAL DEFAULT 0,
      PRIMARY KEY (cluster_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS trend_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id TEXT NOT NULL,
      score REAL NOT NULL,
      taken_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      cluster_id TEXT REFERENCES clusters(id),
      title TEXT NOT NULL,
      format TEXT DEFAULT 'briefing',       -- briefing | deepdive | debate
      language TEXT DEFAULT 'en',           -- en | ar
      style TEXT DEFAULT 'conversational',
      status TEXT DEFAULT 'draft',          -- queued | scripting | script_ready | synthesizing | synthesizing_x_y | evaluating | ready | failed
      progress REAL DEFAULT 0,
      stage_label TEXT,
      error TEXT,
      script TEXT,              -- JSON: {title, description, tags, spoken_chars, segments:[{speaker, voice, direction, text}]}
      script_model TEXT,        -- lineage
      script_hash TEXT,
      audio_path TEXT,
      audio_duration REAL,
      audio_segments INTEGER,
      storyboard TEXT,          -- JSON: {style, aspect, beats:[{index,image_prompt,negative_prompt,caption,duration,segment_range,frame_path}]}
      video_path TEXT,
      video_duration REAL,
      video_status TEXT,        -- pending | storyboard | rendering | ready | failed
      video_error TEXT,
      evaluation TEXT,          -- JSON evaluation blob
      generation_cache TEXT,    -- JSON of request that produced the episode (idempotency)
      play_count INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      published_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);
    CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at DESC);

    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY DEFAULT 'local',
      interests TEXT DEFAULT '[]',        -- JSON array of topic strings
      preferred_language TEXT DEFAULT 'en',
      preferred_voice TEXT DEFAULT 'autumn',
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id TEXT,
      kind TEXT NOT NULL,          -- view | open_intel | generate | play | like | skip
      meta TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_interactions_cluster ON interactions(cluster_id);

    CREATE TABLE IF NOT EXISTS generation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id TEXT NOT NULL,
      kind TEXT NOT NULL,           -- progress | log | error | done
      payload TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,           -- llm_call | tts_call | fetch | cluster | error
      model TEXT,
      tokens_prompt INTEGER DEFAULT 0,
      tokens_completion INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      meta TEXT,
      created_at INTEGER NOT NULL
    );

    -- evidence layer: claims, sourcing, independence, contradictions, snapshots
    CREATE TABLE IF NOT EXISTS cluster_facts (
      id TEXT PRIMARY KEY,
      cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      claim TEXT NOT NULL,
      claim_hash TEXT NOT NULL,       -- dedupe across runs
      status TEXT NOT NULL,           -- confirmed | reported | disputed | retracted
      support_count INTEGER DEFAULT 0,     -- distinct canonical original sources attesting
      attestation_json TEXT NOT NULL,      -- [{article_id, source, url, original_source, attests}]
      canonical_origins TEXT NOT NULL,     -- JSON array of gatekept original outlets
      contradicted_by TEXT,                -- other fact_id(s) opposing this claim
      confidence REAL,                     -- 0..1 final confidence
      first_seen INTEGER, last_seen INTEGER,
      UNIQUE(cluster_id, claim_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_facts_cluster ON cluster_facts(cluster_id);

    CREATE TABLE IF NOT EXISTS living_story (
      cluster_id TEXT PRIMARY KEY REFERENCES clusters(id) ON DELETE CASCADE,
      current_summary TEXT NOT NULL,        -- fused, evolving narrative
      current_summary_at INTEGER,
      version INTEGER DEFAULT 1,             -- bump on each fusion
      timeline TEXT NOT NULL,                -- JSON [{t, event, source_ids:, fact_ids:}] sorted ISO
      last_fused_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS editorials (
      cluster_id TEXT PRIMARY KEY REFERENCES clusters(id) ON DELETE CASCADE,
      bias_json TEXT NOT NULL,               -- per-outlet tone/omission vector
      whats_solid TEXT NOT NULL,             -- consensus claims
      whats_contested TEXT,                  -- disputed claims with both frames
      whats_unknown TEXT,                    -- gaps in coverage
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS publish_gates (
      episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
      score REAL NOT NULL,                   -- 0..1 overall publication confidence
      verdict TEXT NOT NULL,                 -- publish | needs_review
      reasons TEXT NOT NULL,                 -- JSON array of gate decisions
      decided_at INTEGER NOT NULL
    );
  `);

  seedSources(db);
}

import { NEWS_SOURCES } from "./sources";

function seedSources(db: Database.Database) {
  // Upsert so newly added feeds land even after initial provisioning.
  const ins = db.prepare(
    "INSERT OR IGNORE INTO sources (id, name, url, language, lean, country, enabled) VALUES (?,?,?,?,?,?,1)"
  );
  const tx = db.transaction(() => {
    for (const s of NEWS_SOURCES) ins.run(s.id, s.name, s.url, s.language, s.lean, s.country);
  });
  tx();
}
