/**
 * 工具侧 SQLite（§10 单一真相源）：只存源系统装不下的派生/扩展元数据——
 * sites(站点注册) / batches(批次元数据) / inventory_snapshots(盘点快照) /
 * probe_results(探活历史) / recycle(回收站快照) / settings(密码哈希/主密钥)。
 * 实体真相(账号/分组/成员/token/role) 一律实时回源 sub2api，本表绝不持有第二权威副本。
 * 使用 Node 内置 node:sqlite —— 零原生依赖、零编译、跨平台。
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = process.env.CONSOLE_DB_PATH || '/data/console.db'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  gateway_url TEXT NOT NULL,
  admin_key_enc TEXT,
  gateway_key_enc TEXT,
  probe_model TEXT DEFAULT 'gpt-5.5',
  is_active INTEGER DEFAULT 1,
  health TEXT DEFAULT 'unknown',
  last_checked_at TEXT,
  last_latency_ms INTEGER,
  pg_container TEXT,
  ssh_host TEXT,
  kind TEXT DEFAULT 'remote',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  sub2_group_id INTEGER,
  source_path TEXT,
  imported_at TEXT,
  default_priority INTEGER,
  default_concurrency INTEGER,
  default_proxy_id INTEGER,
  notes TEXT,
  total_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER DEFAULT 1,
  batch_id INTEGER,
  taken_at TEXT,
  total INTEGER, alive INTEGER, rate_limited INTEGER, dead INTEGER, no_codex_perm INTEGER,
  tier_free INTEGER, tier_plus INTEGER, tier_pro INTEGER,
  raw_json TEXT
);
CREATE TABLE IF NOT EXISTS probe_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER DEFAULT 1,
  sub2_account_id INTEGER,
  probed_at TEXT,
  verdict TEXT,
  codex_5h_pct REAL, codex_7d_pct REAL,
  plan_type TEXT, is_deactivated INTEGER,
  http_status INTEGER, note TEXT,
  primary_reset_at REAL, secondary_reset_at REAL
);
CREATE TABLE IF NOT EXISTS recycle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER DEFAULT 1,
  sub2_account_id INTEGER,
  cpa_email TEXT, name TEXT,
  access_token TEXT, refresh_token TEXT, id_token TEXT,
  verdict TEXT, deleted_at TEXT, reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_batches_site ON batches(site_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_invsnap_site ON inventory_snapshots(site_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_probe_site ON probe_results(site_id, sub2_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_batches_site_group
  ON batches(site_id, sub2_group_id) WHERE sub2_group_id IS NOT NULL;
`

let _db: DatabaseSync | null = null

export function db(): DatabaseSync {
  if (_db) return _db
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  const d = new DatabaseSync(DB_PATH)
  d.exec('PRAGMA journal_mode = WAL')
  d.exec('PRAGMA busy_timeout = 8000')
  d.exec(SCHEMA)
  _db = d
  return d
}

/** 事务包装（node:sqlite 无 .transaction()）。 */
export function tx(fn: () => void): void {
  const d = db()
  d.exec('BEGIN')
  try { fn(); d.exec('COMMIT') } catch (e) { try { d.exec('ROLLBACK') } catch { /* ignore */ } throw e }
}

const CST_OFFSET_MS = 8 * 3600 * 1000
export function nowCst(): string {
  const d = new Date(Date.now() + CST_OFFSET_MS)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

// ---- settings ----
export function getSetting(key: string): string | null {
  const r = db().prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
  return r ? r.value : null
}
export function setSetting(key: string, value: string): void {
  db().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
}
