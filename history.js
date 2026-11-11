// history.js - רישום מפורט ושליפה של היסטוריית פעולות (רכישות ומסופים)
import { getValidToken } from './auth.js';

const BASE_URL = "https://prod.xn--8dbba8a7b.com";

export const ITEM_TYPES = {
  2: { code: 'credit', name: 'טעינת פעימות' },
  1: { code: 'subscription', name: 'חידוש מנוי חודשי' },
  6: { code: 'license', name: 'חידוש רישיון שנתי' },
};
const ITEM_CODE_TO_TYPE = { credit: 2, subscription: 1, license: 6 };

export const TERMINAL_ACTIONS = {
  openGate: 'פתיחת דלת',
  reload: 'ריענון מסוף',
  reboot: 'הפעלה מחדש',
  checkUpdates: 'בדיקת עדכונים',
};

const digits = v => String(v ?? '').replace(/\D/g, '');
const toIso = v => {
  if (!v) return null;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
};
// קלט תאריך (YYYY-MM-DD או ISO) => פורמט השמירה של SQLite ב-UTC
function toDbDate(v, endOfDay) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + (endOfDay ? ' 23:59:59' : ' 00:00:00');
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}

// ---------------------------------------------------------------
// רישום
// ---------------------------------------------------------------
export async function logPurchase(env, p) {
  const item = ITEM_TYPES[p.itemType] || {};
  const amountAgorot = Math.round(p.amountAgorot || 0);
  try {
    await env.DB.prepare(`INSERT INTO charge_logs
      (club_id, client_id, amount, status, response_msg, api_phone, client_name, personal_id,
       amount_agorot, item_type, item_name, start_date, end_date, card_last4, client_phone, source, api_key_name, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
      .bind(p.clubId, p.clientId, amountAgorot / 100, p.success ? 'SUCCESS' : 'FAILED', p.message || '', p.callerPhone || '',
        p.clientName || '', p.personalId || '', amountAgorot, item.code || null, item.name || null,
        p.startDate || null, p.endDate || null, p.cardLast4 || null, p.clientPhone || null, p.source || 'phone', p.apiKeyName || null)
      .run();
  } catch (e) {
    // תאימות לאחור אם העמודות החדשות עדיין לא קיימות
    await env.DB.prepare("INSERT INTO charge_logs (club_id, client_id, amount, status, response_msg, api_phone, client_name, personal_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(p.clubId, p.clientId, amountAgorot / 100, p.success ? 'SUCCESS' : 'FAILED', p.message || '', p.callerPhone || (p.apiKeyName ? `API:${p.apiKeyName}` : ''), p.clientName || '', p.personalId || '')
      .run();
  }
}

export async function logTerminalAction(env, t) {
  try {
    await env.DB.prepare(`INSERT INTO terminal_logs
      (club_id, username, terminal_id, action_name, status, api_phone, terminal_name, source, api_key_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(t.clubId, t.username || '', t.terminalId, t.action, t.success ? 'SUCCESS' : 'FAILED', t.callerPhone || '',
        t.terminalName || null, t.source || 'phone', t.apiKeyName || null)
      .run();
  } catch (e) {
    await env.DB.prepare("INSERT INTO terminal_logs (club_id, username, terminal_id, action_name, status, api_phone) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(t.clubId, t.username || '', t.terminalId, t.action, t.success ? 'SUCCESS' : 'FAILED', t.callerPhone || (t.apiKeyName ? `API:${t.apiKeyName}` : ''))
      .run();
  }
}

// ---------------------------------------------------------------
// עיצוב רשומות
// ---------------------------------------------------------------
function sourceOf(row) {
  const legacyApi = typeof row.api_phone === 'string' && row.api_phone.startsWith('API:');
  const channel = row.source || (legacyApi ? 'api' : 'phone');
  return {
    channel, // 'phone' = ימות המשיח, 'api' = מפתח API
    caller_phone: channel === 'phone' ? (row.api_phone || null) : null,
    api_key: row.api_key_name || (legacyApi ? row.api_phone.slice(4) : null),
  };
}

export function formatPurchase(row) {
  const agorot = row.amount_agorot != null ? row.amount_agorot : Math.round((row.amount || 0) * 100);
  return {
    id: row.id,
    date: toIso(row.event_time),
    system: { label: row.system_label || null, club_id: row.club_id },
    client: {
      id: row.client_id != null ? String(row.client_id) : null,
      name: row.client_name || null,
      personal_id: row.personal_id || null,
      phone: row.client_phone || null,
    },
    item: {
      type: row.item_type || null,
      name: row.item_name || null,
      start_date: row.start_date || null,
      end_date: row.end_date || null,
    },
    amount: { agorot, shekels: agorot / 100 },
    payment: { status: row.status, success: row.status === 'SUCCESS', message: row.response_msg || null, card_last4: row.card_last4 || null },
    source: sourceOf(row),
  };
}

export function formatTerminalLog(row) {
  return {
    id: row.id,
    date: toIso(row.event_time),
    system: { label: row.system_label || null, club_id: row.club_id },
    terminal: { id: row.terminal_id != null ? String(row.terminal_id) : null, name: row.terminal_name || null },
    action: { code: row.action_name, name: TERMINAL_ACTIONS[row.action_name] || row.action_name },
    status: row.status,
    success: row.status === 'SUCCESS',
    source: sourceOf(row),
    client: null, // מתמלא בזיהוי לפי טלפון המתקשר (resolveTerminalClients)
  };
}

// ---------------------------------------------------------------
// שליפה
// ---------------------------------------------------------------
let chargeTimeExpr = null;
async function chargeTime(env) {
  if (chargeTimeExpr) return chargeTimeExpr;
  const { results } = await env.DB.prepare("PRAGMA table_info(charge_logs)").all();
  const cols = results.map(c => c.name);
  chargeTimeExpr = cols.includes('timestamp') ? 'COALESCE(c.logged_at, c.timestamp)'
    : cols.includes('created_at') ? 'COALESCE(c.logged_at, c.created_at)' : 'c.logged_at';
  return chargeTimeExpr;
}

function clamp(v, def, max) {
  const n = parseInt(v, 10);
  return Math.min(Math.max(isNaN(n) ? def : n, 1), max);
}

// scope: { userId } | { clubId } | { all: true }
function scopeWhere(alias, scope, where, binds) {
  if (scope.clubId != null) { where.push(`${alias}.club_id = ?`); binds.push(scope.clubId); }
  else if (scope.userId != null) { where.push(`${alias}.club_id IN (SELECT target_club_id FROM saas_tokens WHERE user_id = ?)`); binds.push(scope.userId); }
}
const SYSTEM_LABEL = alias => `(SELECT label FROM saas_tokens st WHERE st.target_club_id = ${alias}.club_id ORDER BY st.id LIMIT 1)`;

export async function queryPurchases(env, scope, f = {}) {
  const time = await chargeTime(env);
  const where = [], binds = [];
  scopeWhere('c', scope, where, binds);
  const from = toDbDate(f.from, false), to = toDbDate(f.to, true);
  if (from) { where.push(`${time} >= ?`); binds.push(from); }
  if (to) { where.push(`${time} <= ?`); binds.push(to); }
  if (f.client_id) { where.push('CAST(c.client_id AS TEXT) = ?'); binds.push(String(f.client_id)); }
  if (f.personal_id) { where.push("ltrim(c.personal_id, '0') = ltrim(?, '0')"); binds.push(digits(f.personal_id)); }
  if (f.phone) { where.push("(ltrim(c.client_phone, '0') = ltrim(?, '0') OR ltrim(c.api_phone, '0') = ltrim(?, '0'))"); binds.push(digits(f.phone), digits(f.phone)); }
  if (f.status) { where.push('c.status = ?'); binds.push(String(f.status).toUpperCase()); }
  if (f.type && ITEM_CODE_TO_TYPE[f.type]) { where.push('c.item_type = ?'); binds.push(f.type); }
  if (f.source === 'api') where.push("(c.source = 'api' OR c.api_phone LIKE 'API:%')");
  if (f.source === 'phone') where.push("(c.source = 'phone' OR (c.source IS NULL AND (c.api_phone IS NULL OR c.api_phone NOT LIKE 'API:%')))");
  if (f.search) {
    where.push("(c.client_name LIKE ? OR c.personal_id LIKE ? OR c.client_phone LIKE ? OR c.api_phone LIKE ? OR CAST(c.client_id AS TEXT) = ?)");
    const s = `%${f.search}%`; binds.push(s, s, s, s, String(f.search));
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = clamp(f.limit, 100, 1000), offset = Math.max(parseInt(f.offset, 10) || 0, 0);

  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM charge_logs c ${w}`).bind(...binds).first()).n;
  const sums = await env.DB.prepare(`SELECT COALESCE(SUM(COALESCE(c.amount_agorot, ROUND(c.amount * 100))), 0) AS agorot FROM charge_logs c ${w} ${w ? 'AND' : 'WHERE'} c.status = 'SUCCESS'`).bind(...binds).first();
  const { results } = await env.DB.prepare(`SELECT c.*, ${time} AS event_time, ${SYSTEM_LABEL('c')} AS system_label
      FROM charge_logs c ${w} ORDER BY ${time} DESC, c.rowid DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();

  return { total, limit, offset, total_success_agorot: sums.agorot, purchases: results.map(formatPurchase) };
}

export async function queryTerminalLogs(env, scope, f = {}) {
  const where = [], binds = [];
  scopeWhere('l', scope, where, binds);
  const from = toDbDate(f.from, false), to = toDbDate(f.to, true);
  if (from) { where.push('l.timestamp >= ?'); binds.push(from); }
  if (to) { where.push('l.timestamp <= ?'); binds.push(to); }
  if (f.terminal_id) { where.push('CAST(l.terminal_id AS TEXT) = ?'); binds.push(String(f.terminal_id)); }
  if (f.action) { where.push('l.action_name = ?'); binds.push(f.action); }
  if (f.status) { where.push('l.status = ?'); binds.push(String(f.status).toUpperCase()); }
  if (f.phone) { where.push("ltrim(l.api_phone, '0') = ltrim(?, '0')"); binds.push(digits(f.phone)); }
  if (f.source === 'api') where.push("(l.source = 'api' OR l.api_phone LIKE 'API:%')");
  if (f.source === 'phone') where.push("(l.source = 'phone' OR (l.source IS NULL AND (l.api_phone IS NULL OR l.api_phone NOT LIKE 'API:%')))");
  if (f.search) {
    where.push('(l.api_phone LIKE ? OR l.terminal_name LIKE ? OR CAST(l.terminal_id AS TEXT) = ?)');
    const s = `%${f.search}%`; binds.push(s, s, String(f.search));
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = clamp(f.limit, 100, 1000), offset = Math.max(parseInt(f.offset, 10) || 0, 0);

  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM terminal_logs l ${w}`).bind(...binds).first()).n;
  const { results } = await env.DB.prepare(`SELECT l.*, l.timestamp AS event_time, ${SYSTEM_LABEL('l')} AS system_label
      FROM terminal_logs l ${w} ORDER BY l.timestamp DESC, l.rowid DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();

  return { total, limit, offset, logs: results.map(formatTerminalLog) };
}

// ---------------------------------------------------------------
// זיהוי "מי פתח": התאמת טלפון המתקשר ללקוח במערכת הניהול
// ---------------------------------------------------------------
export async function resolveTerminalClients(env, logs) {
  const need = logs.filter(l => l.source.caller_phone);
  if (!need.length) return logs;
  const clubIds = [...new Set(need.map(l => l.system.club_id))];

  for (const clubId of clubIds) {
    try {
      const creds = await env.DB.prepare("SELECT target_club_id, target_username, target_password FROM saas_tokens WHERE target_club_id = ? ORDER BY id LIMIT 1").bind(clubId).first();
      if (!creds) continue;
      const token = await getValidToken({ club: creds.target_club_id, user: creds.target_username, pass: creds.target_password }, env);
      const res = await fetch(`${BASE_URL}/Client`, { headers: { "Authorization": `Bearer ${token}`, "clubExternalId": clubId } });
      if (!res.ok) continue;
      const raw = await res.json();
      const list = Array.isArray(raw) ? raw : (raw.data || raw.items || []);
      const byPhone = new Map();
      for (const c of list) {
        const p = digits(c.phone).replace(/^0+/, '');
        if (p && !byPhone.has(p)) byPhone.set(p, c);
      }
      for (const l of need) {
        if (l.system.club_id !== clubId) continue;
        const c = byPhone.get(digits(l.source.caller_phone).replace(/^0+/, ''));
        if (c) l.client = { id: String(c.id), name: `${c.firstName || ''} ${c.lastName || ''}`.trim(), personal_id: c.personalId || null, phone: c.phone || null, matched_by: 'caller_phone' };
      }
    } catch (e) { /* זיהוי הוא תוספת - לא מכשילים את הבקשה */ }
  }
  return logs;
}
