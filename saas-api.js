import { ensureSchema } from './schema.js';
import { SCOPES, parseScopes, userAllowedScopes, effectiveKeyScopes } from './scopes.js';
import { sha256Hex } from './public-api.js';
import { queryPurchases, queryTerminalLogs, resolveTerminalClients } from './history.js';

// אותו Client ID של גוגל כמו באתר סלומון (ניתן לדרוס עם משתנה סביבה GOOGLE_CLIENT_ID)
export const DEFAULT_GOOGLE_CLIENT_ID = "89500817024-tbvsuu4dci6bqh173l65ua9lc65pe24p.apps.googleusercontent.com";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 יום

const USER_FIELDS = "id, name, email, max_tokens, is_admin, can_view_history, can_use_payment, can_use_terminal, api_scopes, avatar_url";

function randomToken(bytes = 24) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSession(env, userId) {
  const token = 'sess_' + randomToken(24);
  await env.DB.prepare("INSERT INTO saas_sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, userId, Math.floor(Date.now() / 1000) + SESSION_TTL).run();
  return token;
}

function publicUser(u) {
  if (!u) return u;
  return { ...u, allowed_api_scopes: userAllowedScopes(u) };
}

export async function handleSaasRequest(request, env) {
  await ensureSchema(env);

  const url = new URL(request.url);
  const apiIndex = url.pathname.indexOf('/api');
  const path = apiIndex !== -1 ? url.pathname.substring(apiIndex + 4) : url.pathname;
  const parts = path.split('/');

  const jsonResponse = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  const readBody = async () => { try { return await request.json(); } catch (e) { return {}; } };

  // ----------------------------------------------------
  // נתיבים ציבוריים (ללא התחברות)
  // ----------------------------------------------------
  if (request.method === 'GET' && path === '/config') {
    return jsonResponse({ success: true, google_client_id: env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID, scopes: SCOPES });
  }

  if (request.method === 'POST' && path === '/register') {
    const { name, email, password } = await readBody();
    if (!email || !password) return jsonResponse({ success: false, message: "חובה להזין מייל וסיסמה" }, 400);
    try {
      await env.DB.prepare("INSERT INTO saas_users (name, email, password) VALUES (?, ?, ?)").bind(name || "", email, password).run();
      return jsonResponse({ success: true, message: "המשתמש נוצר בהצלחה" });
    } catch (e) {
      return jsonResponse({ success: false, message: "שגיאה ביצירת משתמש ייתכן שהמייל כבר קיים" }, 400);
    }
  }

  if (request.method === 'POST' && path === '/login') {
    const { email, password } = await readBody();
    if (!email || !password) return jsonResponse({ success: false, message: "חובה להזין מייל וסיסמה" }, 400);
    const user = await env.DB.prepare(`SELECT ${USER_FIELDS} FROM saas_users WHERE email = ? AND password = ?`).bind(email, password).first();
    if (!user) return jsonResponse({ success: false, message: "פרטי התחברות שגויים" }, 401);
    const token = await createSession(env, user.id);
    return jsonResponse({ success: true, token, user: publicUser(user) });
  }

  if (request.method === 'POST' && path === '/login/google') {
    const { credential } = await readBody();
    if (!credential) return jsonResponse({ success: false, message: "חסר אסימון גוגל" }, 400);

    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!verifyRes.ok) return jsonResponse({ success: false, message: "אימות מול גוגל נכשל" }, 401);
    const g = await verifyRes.json();

    const clientId = env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
    const validIssuer = g.iss === 'accounts.google.com' || g.iss === 'https://accounts.google.com';
    const notExpired = Number(g.exp) * 1000 > Date.now();
    if (g.aud !== clientId || !validIssuer || !notExpired || String(g.email_verified) !== 'true' || !g.email) {
      return jsonResponse({ success: false, message: "אסימון גוגל לא תקף" }, 401);
    }

    const email = g.email.toLowerCase();
    let user = await env.DB.prepare(`SELECT ${USER_FIELDS} FROM saas_users WHERE lower(email) = ?`).bind(email).first();

    if (!user) {
      // משתמש חדש נוצר ללא הרשאות - מנהל צריך לאשר לו הרשאות
      await env.DB.prepare(`INSERT INTO saas_users (name, email, password, max_tokens, can_view_history, can_use_payment, can_use_terminal, api_scopes, google_sub, avatar_url)
                            VALUES (?, ?, ?, 1, 0, 0, 0, '', ?, ?)`)
        .bind(g.name || "", email, 'google:' + randomToken(16), g.sub, g.picture || null).run();
      user = await env.DB.prepare(`SELECT ${USER_FIELDS} FROM saas_users WHERE lower(email) = ?`).bind(email).first();
    } else {
      await env.DB.prepare("UPDATE saas_users SET google_sub = ?, avatar_url = ?, name = CASE WHEN name IS NULL OR name = '' THEN ? ELSE name END WHERE id = ?")
        .bind(g.sub, g.picture || null, g.name || "", user.id).run();
      user.avatar_url = g.picture || user.avatar_url;
    }

    const token = await createSession(env, user.id);
    return jsonResponse({ success: true, token, user: publicUser(user) });
  }

  // ----------------------------------------------------
  // אימות: Bearer sess_... (חדש) או Basic (תאימות לאחור)
  // ----------------------------------------------------
  const authHeader = request.headers.get("Authorization") || "";
  let currentUser = null;
  let sessionToken = null;

  if (authHeader.startsWith("Bearer sess_")) {
    sessionToken = authHeader.slice(7).trim();
    currentUser = await env.DB.prepare(`
      SELECT ${USER_FIELDS.split(', ').map(f => 'u.' + f).join(', ')}
      FROM saas_sessions s JOIN saas_users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`).bind(sessionToken, Math.floor(Date.now() / 1000)).first();
  } else if (authHeader.startsWith("Basic ")) {
    let email, password;
    try {
      const decoded = atob(authHeader.replace("Basic ", ""));
      const idx = decoded.indexOf(':');
      email = decoded.slice(0, idx); password = decoded.slice(idx + 1);
    } catch (e) {
      return jsonResponse({ success: false, message: "טוקן אימות לא חוקי" }, 401);
    }
    currentUser = await env.DB.prepare(`SELECT ${USER_FIELDS} FROM saas_users WHERE email = ? AND password = ?`).bind(email, password).first();
  } else {
    return jsonResponse({ success: false, message: "חסר זיהוי משתמש או פורמט שגוי" }, 401);
  }

  if (!currentUser) {
    return jsonResponse({ success: false, message: "פרטי התחברות שגויים או שהחיבור פג תוקף" }, 401);
  }

  if (request.method === 'GET' && path === '/me') {
    return jsonResponse({ success: true, user: publicUser(currentUser) });
  }

  if (request.method === 'POST' && path === '/logout') {
    if (sessionToken) await env.DB.prepare("DELETE FROM saas_sessions WHERE token = ?").bind(sessionToken).run();
    return jsonResponse({ success: true });
  }

  // הצגת הטוקנים כולל פרטי ההתחברות ללקוח
  if (request.method === 'GET' && path === '/tokens') {
    const { results } = await env.DB.prepare("SELECT id, token, target_club_id, target_username, target_password, label, created_at FROM saas_tokens WHERE user_id = ?").bind(currentUser.id).all();
    return jsonResponse({ success: true, tokens: results });
  }

  if (request.method === 'POST' && path === '/tokens') {
    const { club_id, username, password, label } = await readBody();
    if (!club_id || !username || !password) return jsonResponse({ success: false, message: "נא למלא את כל השדות" }, 400);

    const { results: existingTokens } = await env.DB.prepare("SELECT id FROM saas_tokens WHERE user_id = ?").bind(currentUser.id).all();
    if (existingTokens.length >= currentUser.max_tokens) {
      return jsonResponse({ success: false, message: "הגעת למגבלת הטוקנים בחשבונך" }, 403);
    }

    const newToken = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare("INSERT INTO saas_tokens (user_id, token, target_club_id, target_username, target_password, label) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(currentUser.id, newToken, club_id, username, password, label || "מערכת ללא שם")
      .run();

    return jsonResponse({ success: true, token: newToken });
  }

  // עדכון פרטי טוקן קיים
  if (request.method === 'POST' && parts[1] === 'tokens' && parts[3] === 'update') {
    const tokenId = parts[2];
    const { club_id, username, password, label } = await readBody();
    await env.DB.prepare("UPDATE saas_tokens SET target_club_id = ?, target_username = ?, target_password = ?, label = ? WHERE id = ? AND user_id = ?")
      .bind(club_id, username, password, label, tokenId, currentUser.id).run();
    return jsonResponse({ success: true, message: "הטוקן עודכן בהצלחה" });
  }

  if (request.method === 'DELETE' && parts[1] === 'tokens' && parts[2] && parts.length === 3) {
    const tokenId = parts[2];
    await env.DB.prepare("DELETE FROM saas_tokens WHERE id = ? AND user_id = ?").bind(tokenId, currentUser.id).run();
    await env.DB.prepare("UPDATE saas_api_keys SET revoked = 1 WHERE token_id = ? AND user_id = ?").bind(tokenId, currentUser.id).run();
    return jsonResponse({ success: true, message: "הטוקן נמחק בהצלחה" });
  }

  // ----------------------------------------------------
  // מפתחות API
  // ----------------------------------------------------
  if (request.method === 'GET' && path === '/api-keys') {
    const { results } = await env.DB.prepare(`
      SELECT k.id, k.name, k.key_prefix, k.scopes, k.token_id, k.last_used_at, k.created_at, t.label AS system_label, t.target_club_id
      FROM saas_api_keys k LEFT JOIN saas_tokens t ON t.id = k.token_id
      WHERE k.user_id = ? AND k.revoked = 0 ORDER BY k.id DESC`).bind(currentUser.id).all();
    const keys = results.map(k => ({ ...k, requested_scopes: parseScopes(k.scopes), scopes: effectiveKeyScopes(k.scopes, currentUser) }));
    return jsonResponse({ success: true, api_keys: keys, allowed_scopes: userAllowedScopes(currentUser) });
  }

  if (request.method === 'POST' && path === '/api-keys') {
    const { name, token_id, scopes } = await readBody();
    const allowed = userAllowedScopes(currentUser);
    if (allowed.length === 0) return jsonResponse({ success: false, message: "לחשבון שלך אין הרשאת API. פנה למנהל המערכת" }, 403);

    const system = await env.DB.prepare("SELECT id FROM saas_tokens WHERE id = ? AND user_id = ?").bind(token_id, currentUser.id).first();
    if (!system) return jsonResponse({ success: false, message: "יש לבחור מערכת (טוקן חיבור) קיימת" }, 400);

    let requested = parseScopes(scopes);
    if (requested.includes('*')) {
      requested = allowed.length === SCOPES.length ? ['*'] : allowed; // '*' רק אם יש למשתמש את כל ההרשאות
    } else {
      const bad = requested.filter(s => !allowed.includes(s));
      if (bad.length) return jsonResponse({ success: false, message: `אין לך הרשאה להעניק: ${bad.join(', ')}` }, 403);
    }
    if (requested.length === 0) return jsonResponse({ success: false, message: "יש לבחור לפחות הרשאה אחת" }, 400);

    const { results: existing } = await env.DB.prepare("SELECT id FROM saas_api_keys WHERE user_id = ? AND revoked = 0").bind(currentUser.id).all();
    if (existing.length >= 20) return jsonResponse({ success: false, message: "הגעת למגבלה של 20 מפתחות פעילים" }, 403);

    const plainKey = 'mk_live_' + randomToken(24);
    const keyHash = await sha256Hex(plainKey);
    await env.DB.prepare("INSERT INTO saas_api_keys (user_id, token_id, name, key_prefix, key_hash, scopes) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(currentUser.id, system.id, (name || 'מפתח ללא שם').slice(0, 80), plainKey.slice(0, 14), keyHash, requested.join(',')).run();

    // המפתח המלא מוחזר פעם אחת בלבד
    return jsonResponse({ success: true, api_key: plainKey, scopes: requested });
  }

  if (request.method === 'DELETE' && parts[1] === 'api-keys' && parts[2] && parts.length === 3) {
    await env.DB.prepare("UPDATE saas_api_keys SET revoked = 1 WHERE id = ? AND user_id = ?").bind(parts[2], currentUser.id).run();
    return jsonResponse({ success: true, message: "המפתח בוטל" });
  }

  // היסטוריה מפורטת: רכישות ופעולות מסופים
  if (request.method === 'GET' && (path === '/logs' || path === '/purchase-logs')) {
    if (!currentUser.can_view_history && !currentUser.is_admin) {
      return jsonResponse({ success: false, message: "אין הרשאה לצפות בהיסטוריה" }, 403);
    }
    const f = Object.fromEntries(['from', 'to', 'client_id', 'personal_id', 'phone', 'status', 'type', 'source', 'search', 'terminal_id', 'action', 'limit', 'offset'].map(k => [k, url.searchParams.get(k)]));
    // מנהל רואה את כל המערכות (או מערכת מסוימת עם club_id), לקוח רק את המערכות שלו
    const scope = currentUser.is_admin
      ? (url.searchParams.get('club_id') ? { clubId: url.searchParams.get('club_id') } : { all: true })
      : (url.searchParams.get('club_id') ? { userId: currentUser.id, clubId: url.searchParams.get('club_id') } : { userId: currentUser.id });
    if (scope.userId && scope.clubId) {
      const own = await env.DB.prepare("SELECT 1 FROM saas_tokens WHERE user_id = ? AND target_club_id = ?").bind(currentUser.id, scope.clubId).first();
      if (!own) return jsonResponse({ success: false, message: "מערכת לא נמצאה" }, 404);
      delete scope.userId;
    }

    if (path === '/purchase-logs') {
      return jsonResponse({ success: true, ...(await queryPurchases(env, scope, f)) });
    }
    const r = await queryTerminalLogs(env, scope, f);
    if (url.searchParams.get('resolve_clients') !== '0') await resolveTerminalClients(env, r.logs);
    return jsonResponse({ success: true, ...r });
  }

  // ----------------------------------------------------
  // אזור ניהול - למנהלים בלבד
  // ----------------------------------------------------
  if (!currentUser.is_admin) {
     return jsonResponse({ success: false, message: "נתיב לא נמצא" }, 404);
  }

  if (request.method === 'GET' && path === '/users') {
    const { results } = await env.DB.prepare(`SELECT ${USER_FIELDS}, created_at FROM saas_users`).all();
    return jsonResponse({ success: true, users: results.map(u => ({ ...u, api_scopes: parseScopes(u.api_scopes) })) });
  }

  if (request.method === 'POST' && path === '/users') {
    const { name, email, password, max_tokens, can_view_history, can_use_payment, can_use_terminal, api_scopes } = await readBody();
    if (!email) return jsonResponse({ success: false, message: "חובה להזין מייל" }, 400);
    try {
      await env.DB.prepare("INSERT INTO saas_users (name, email, password, max_tokens, can_view_history, can_use_payment, can_use_terminal, api_scopes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(name || "", email, password || ('google:' + randomToken(16)), max_tokens || 1, can_view_history ? 1 : 0, can_use_payment ? 1 : 0, can_use_terminal ? 1 : 0, parseScopes(api_scopes).join(',')).run();
      return jsonResponse({ success: true, message: "הלקוח נוצר" });
    } catch (e) {
      return jsonResponse({ success: false, message: "שגיאה, ייתכן שהמייל קיים" }, 400);
    }
  }

  if (request.method === 'PATCH' && parts[1] === 'users' && parts[2]) {
    const targetUserId = parts[2];
    const { name, max_tokens, can_view_history, can_use_payment, can_use_terminal, api_scopes } = await readBody();
    await env.DB.prepare("UPDATE saas_users SET name = COALESCE(?, name), max_tokens = ?, can_view_history = ?, can_use_payment = ?, can_use_terminal = ?, api_scopes = ? WHERE id = ?")
      .bind(name === undefined ? null : name, max_tokens || 1, can_view_history ? 1 : 0, can_use_payment ? 1 : 0, can_use_terminal ? 1 : 0, parseScopes(api_scopes).join(','), targetUserId).run();
    return jsonResponse({ success: true, message: "הגדרות לקוח עודכנו" });
  }

  if (request.method === 'GET' && path === '/admin/tokens') {
    const { results } = await env.DB.prepare(`
      SELECT t.id, t.user_id, t.token, t.target_club_id, t.target_username, t.target_password, t.label, t.created_at, u.email as owner_email, u.name as owner_name
      FROM saas_tokens t
      JOIN saas_users u ON t.user_id = u.id
    `).all();
    return jsonResponse({ success: true, tokens: results });
  }

  if (request.method === 'GET' && path === '/admin/api-keys') {
    const { results } = await env.DB.prepare(`
      SELECT k.id, k.name, k.key_prefix, k.scopes, k.last_used_at, k.created_at, t.label AS system_label, u.email AS owner_email, u.name AS owner_name
      FROM saas_api_keys k JOIN saas_users u ON u.id = k.user_id LEFT JOIN saas_tokens t ON t.id = k.token_id
      WHERE k.revoked = 0 ORDER BY k.id DESC`).all();
    return jsonResponse({ success: true, api_keys: results.map(k => ({ ...k, scopes: parseScopes(k.scopes) })) });
  }

  if (request.method === 'DELETE' && parts[1] === 'admin' && parts[2] === 'api-keys' && parts[3]) {
    await env.DB.prepare("UPDATE saas_api_keys SET revoked = 1 WHERE id = ?").bind(parts[3]).run();
    return jsonResponse({ success: true, message: "המפתח בוטל" });
  }

  // העברת טוקן (POST במקום PATCH)
  if (request.method === 'POST' && parts[1] === 'admin' && parts[2] === 'tokens' && parts[4] === 'transfer') {
    const tokenId = parts[3];
    const { new_user_id } = await readBody();
    await env.DB.prepare("UPDATE saas_tokens SET user_id = ? WHERE id = ?").bind(new_user_id, tokenId).run();
    // מפתחות API של הבעלים הקודם על מערכת זו מבוטלים
    await env.DB.prepare("UPDATE saas_api_keys SET revoked = 1 WHERE token_id = ? AND user_id != ?").bind(tokenId, new_user_id).run();
    return jsonResponse({ success: true, message: "הטוקן הועבר בהצלחה" });
  }

  return jsonResponse({ success: false, message: "נתיב לא נמצא" }, 404);
}
