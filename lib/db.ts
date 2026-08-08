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
  `);

  seedSources(db);
}

import { NEWS_SOURCES } from "./sources";

function seedSources(db: Database.Database) {
  const count = (db.prepare("SELECT COUNT(*) c FROM sources").get() as { c: number }).c;
  if (count > 0) return;
  const insert = db.prepare(
    "INSERT INTO sources (id, name, url, language, lean, country, enabled) VALUES (?,?,?,?,?,?,1)"
  );
  const tx = db.transaction(() => {
    for (const s of NEWS_SOURCES) insert.run(s.id, s.name, s.url, s.language, s.lean, s.country);
  });
  tx();
}
