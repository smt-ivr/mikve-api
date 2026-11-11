// schema.js - יצירה/עדכון אוטומטי של טבלאות נדרשות (פעם אחת לכל isolate)
let schemaReady = false;

export async function ensureSchema(env) {
  if (schemaReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS saas_sessions (
       token TEXT PRIMARY KEY,
       user_id INTEGER NOT NULL,
       expires_at INTEGER NOT NULL,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS saas_api_keys (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INTEGER NOT NULL,
       token_id INTEGER NOT NULL,
       name TEXT,
       key_prefix TEXT NOT NULL,
       key_hash TEXT NOT NULL UNIQUE,
       scopes TEXT NOT NULL DEFAULT '',
       revoked INTEGER NOT NULL DEFAULT 0,
       last_used_at TEXT,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_user ON saas_api_keys(user_id)`,
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();

  // עמודות חדשות בטבלאות קיימות - מתעלמים אם כבר קיימות
  const alters = [
    `ALTER TABLE saas_users ADD COLUMN api_scopes TEXT DEFAULT ''`,
    `ALTER TABLE saas_users ADD COLUMN google_sub TEXT`,
    `ALTER TABLE saas_users ADD COLUMN avatar_url TEXT`,
  ];
  for (const sql of alters) {
    try { await env.DB.prepare(sql).run(); } catch (e) { /* duplicate column */ }
  }

  // ניקוי סשנים שפג תוקפם
  try {
    await env.DB.prepare("DELETE FROM saas_sessions WHERE expires_at < ?").bind(Math.floor(Date.now() / 1000)).run();
  } catch (e) {}

  schemaReady = true;
}
