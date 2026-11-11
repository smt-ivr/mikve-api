// public-api.js - API ציבורי ללקוחות, מאובטח במפתח API עם הרשאות (scopes)
import { getValidToken } from './auth.js';
import { effectiveKeyScopes } from './scopes.js';
import { logPurchase, logTerminalAction, queryPurchases, queryTerminalLogs, resolveTerminalClients } from './history.js';

const BASE_URL = "https://prod.xn--8dbba8a7b.com";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const err = (status, code, message) => json({ success: false, error: { code, message } }, status);

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractApiKey(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return (request.headers.get('X-API-Key') || '').trim();
}

const toList = raw => Array.isArray(raw) ? raw : (raw?.data || raw?.items || []);
const digits = v => String(v ?? '').replace(/\D/g, '');

function maskCard(card) {
  const out = { ...card };
  for (const k of Object.keys(out)) {
    if (/cvv/i.test(k)) delete out[k];
    else if (/(card)?number|ccnum/i.test(k) && typeof out[k] === 'string' && out[k].length > 4) {
      out[k] = '****' + out[k].slice(-4);
    }
  }
  return out;
}

export async function handlePublicApi(request, env, subPath) {
  // ---------- אימות מפתח ----------
  const apiKey = extractApiKey(request);
  if (!apiKey || !apiKey.startsWith('mk_')) {
    return err(401, 'missing_api_key', 'חסר מפתח API. שלחו Authorization: Bearer mk_...');
  }

  const keyHash = await sha256Hex(apiKey);
  const row = await env.DB.prepare(`
    SELECT k.id AS key_id, k.scopes, k.revoked, k.name AS key_name,
           u.id AS user_id, u.is_admin, u.api_scopes,
           t.id AS token_id, t.target_club_id, t.target_username, t.target_password, t.label
    FROM saas_api_keys k
    JOIN saas_users u ON u.id = k.user_id
    JOIN saas_tokens t ON t.id = k.token_id AND t.user_id = k.user_id
    WHERE k.key_hash = ?`).bind(keyHash).first();

  if (!row || row.revoked) return err(401, 'invalid_api_key', 'מפתח API לא חוקי או שבוטל');

  const scopes = effectiveKeyScopes(row.scopes, row);
  await env.DB.prepare("UPDATE saas_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.key_id).run();

  const need = (...anyOf) => anyOf.some(s => scopes.includes(s)) ? null :
    err(403, 'insufficient_scope', `למפתח זה אין הרשאה: ${anyOf.join(' או ')}`);
  const filters = () => Object.fromEntries(['from', 'to', 'client_id', 'personal_id', 'phone', 'status', 'type', 'source', 'search', 'terminal_id', 'action', 'limit', 'offset'].map(k => [k, q.get(k)]));

  const method = request.method;
  const parts = subPath.split('/').filter(Boolean); // e.g. ['clients','123']
  const q = new URL(request.url).searchParams;
  const clubId = row.target_club_id;

  // ---------- חיבור למערכת היעד ----------
  let upstreamToken = null;
  const upstream = async (path, opts = {}) => {
    if (!upstreamToken) {
      upstreamToken = await getValidToken({ club: clubId, user: row.target_username, pass: row.target_password }, env);
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method: opts.method || 'GET',
      headers: { "Authorization": `Bearer ${upstreamToken}`, "clubExternalId": clubId, "Content-Type": "application/json" },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    return { ok: res.ok, status: res.status, data };
  };
  const upstreamFail = r => err(502, 'upstream_error', `שגיאה ממערכת הניהול (HTTP ${r.status})`);

  const readBody = async () => { try { return await request.json(); } catch (e) { return null; } };

  try {
    // GET /v1/me
    if (method === 'GET' && parts[0] === 'me' && parts.length === 1) {
      return json({ success: true, key: { name: row.key_name, scopes }, system: { id: row.token_id, label: row.label, club_id: clubId } });
    }

    // ---------- היסטוריה ----------
    if (method === 'GET' && parts[0] === 'history') {
      const resolve = q.get('resolve_clients') !== '0';
      if (parts[1] === 'purchases' && parts.length === 2) {
        const d = need('history:purchases', 'purchases:read'); if (d) return d;
        return json({ success: true, ...(await queryPurchases(env, { clubId }, filters())) });
      }
      if (parts[1] === 'terminals' && parts.length === 2) {
        const d = need('history:terminals', 'terminals:read'); if (d) return d;
        const r = await queryTerminalLogs(env, { clubId }, filters());
        if (resolve) await resolveTerminalClients(env, r.logs);
        return json({ success: true, ...r });
      }
      if (parts.length === 1) {
        const canP = scopes.includes('history:purchases') || scopes.includes('purchases:read');
        const canT = scopes.includes('history:terminals') || scopes.includes('terminals:read');
        if (!canP && !canT) return need('history:purchases', 'history:terminals');
        const f = filters();
        const out = { success: true, events: [] };
        if (canP) {
          const p = await queryPurchases(env, { clubId }, f);
          out.purchases_total = p.total;
          out.events.push(...p.purchases.map(x => ({ kind: 'purchase', ...x })));
        }
        if (canT) {
          const t = await queryTerminalLogs(env, { clubId }, f);
          if (resolve) await resolveTerminalClients(env, t.logs);
          out.terminal_actions_total = t.total;
          out.events.push(...t.logs.map(x => ({ kind: 'terminal_action', ...x })));
        }
        out.events.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        out.events = out.events.slice(0, Math.min(parseInt(f.limit, 10) || 100, 1000));
        return json(out);
      }
    }

    // ---------- מערכת ----------
    if (method === 'GET' && parts[0] === 'club' && parts.length === 1) {
      const d = need('club:read'); if (d) return d;
      const r = await upstream('/Club/GetCurrent');
      return r.ok ? json({ success: true, club: r.data }) : upstreamFail(r);
    }
    if (method === 'GET' && parts[0] === 'groups' && parts.length === 1) {
      const d = need('club:read'); if (d) return d;
      const r = await upstream('/Group');
      return r.ok ? json({ success: true, groups: toList(r.data) }) : upstreamFail(r);
    }

    // ---------- לקוחות ----------
    if (parts[0] === 'clients') {
      const clientId = parts[1];

      if (method === 'GET' && parts.length === 1) {
        const d = need('clients:read'); if (d) return d;
        const r = await upstream('/Client');
        if (!r.ok) return upstreamFail(r);
        let list = toList(r.data);
        const phone = digits(q.get('phone')), pid = digits(q.get('personal_id')), search = (q.get('search') || '').trim().toLowerCase();
        if (phone) list = list.filter(c => digits(c.phone).replace(/^0+/, '') === phone.replace(/^0+/, ''));
        if (pid) list = list.filter(c => digits(c.personalId).replace(/^0+/, '') === pid.replace(/^0+/, ''));
        if (search) list = list.filter(c => `${c.firstName || ''} ${c.lastName || ''} ${c.phone || ''} ${c.personalId || ''} ${c.email || ''}`.toLowerCase().includes(search));
        const total = list.length;
        const limit = Math.min(Math.max(parseInt(q.get('limit') || '100', 10) || 100, 1), 500);
        const offset = Math.max(parseInt(q.get('offset') || '0', 10) || 0, 0);
        return json({ success: true, total, limit, offset, clients: list.slice(offset, offset + limit) });
      }

      if (method === 'GET' && clientId && parts.length === 2) {
        const d = need('clients:read'); if (d) return d;
        const r = await upstream(`/Client/${encodeURIComponent(clientId)}`);
        return r.ok ? json({ success: true, client: r.data }) : (r.status === 404 ? err(404, 'not_found', 'לקוח לא נמצא') : upstreamFail(r));
      }

      if (method === 'PATCH' && clientId && parts.length === 2) {
        const d = need('clients:write'); if (d) return d;
        const changes = await readBody();
        if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return err(400, 'invalid_body', 'יש לשלוח אובייקט JSON עם השדות לעדכון');
        delete changes.id;
        const cur = await upstream(`/Client/${encodeURIComponent(clientId)}`);
        if (!cur.ok) return cur.status === 404 ? err(404, 'not_found', 'לקוח לא נמצא') : upstreamFail(cur);
        const merged = { ...cur.data, ...changes };
        const r = await upstream(`/Client/${encodeURIComponent(clientId)}`, { method: 'PATCH', body: merged });
        return r.ok ? json({ success: true, client: (r.data && typeof r.data === 'object') ? r.data : merged }) : upstreamFail(r);
      }

      if (method === 'GET' && clientId && parts[2] === 'credit-cards' && parts.length === 3) {
        const d = need('cards:read'); if (d) return d;
        const r = await upstream(`/CreditCard/GetByClientId/${encodeURIComponent(clientId)}`);
        if (!r.ok) return upstreamFail(r);
        const raw = r.data;
        const cards = Array.isArray(raw) ? raw : (raw?.data || raw?.items || (raw && typeof raw === 'object' ? [raw] : []));
        return json({ success: true, credit_cards: cards.map(maskCard) });
      }

      if (method === 'GET' && clientId && parts[2] === 'subscription-renewal' && parts.length === 3) {
        const d = need('purchases:read'); if (d) return d;
        const r = await upstream(`/GetRenewSubscriptionStartAndEndDatesAndPrice/${encodeURIComponent(clientId)}`, { method: 'POST', body: {} });
        if (!r.ok) return upstreamFail(r);
        return json({ success: true, renewal: { from_date: r.data?.fromDate, to_date: r.data?.toDate, price_agorot: r.data?.price || 0, raw: r.data } });
      }
    }

    // ---------- רכישות ----------
    if (parts[0] === 'purchases' && parts.length === 1) {
      if (method === 'GET') {
        const d = need('purchases:read', 'history:purchases'); if (d) return d;
        return json({ success: true, ...(await queryPurchases(env, { clubId }, filters())) });
      }

      if (method === 'POST') {
        const d = need('purchases:write'); if (d) return d;
        const b = await readBody();
        if (!b) return err(400, 'invalid_body', 'גוף הבקשה חייב להיות JSON');
        const typeMap = { credit: 2, subscription: 1, license: 6 };
        const itemType = typeMap[b.type];
        if (!itemType) return err(400, 'invalid_type', 'type חייב להיות credit / subscription / license');
        if (!b.client_id) return err(400, 'missing_client_id', 'חסר client_id');
        const card = b.card || {};
        const ccNum = digits(card.number), exp = digits(card.exp), cvv = digits(card.cvv);
        if (ccNum.length < 8 || exp.length !== 4 || cvv.length < 3) return err(400, 'invalid_card', 'card.number, card.exp (MMYY), card.cvv נדרשים');

        const cRes = await upstream(`/Client/${encodeURIComponent(b.client_id)}`);
        if (!cRes.ok) return cRes.status === 404 ? err(404, 'not_found', 'לקוח לא נמצא') : upstreamFail(cRes);
        const client = cRes.data;
        const actualClubId = client.clubId;

        let amount = 0, dates = null;
        if (itemType === 2) {
          amount = parseInt(b.amount_agorot, 10);
          if (!amount || amount <= 0) return err(400, 'invalid_amount', 'עבור credit יש לשלוח amount_agorot חיובי');
        } else if (itemType === 1) {
          const s = await upstream(`/GetRenewSubscriptionStartAndEndDatesAndPrice/${encodeURIComponent(client.id)}`, { method: 'POST', body: {} });
          if (!s.ok) return upstreamFail(s);
          amount = s.data?.price || 0;
          dates = { startDate: s.data?.fromDate, endDate: s.data?.toDate };
        } else {
          const c = await upstream('/Club/GetCurrent');
          if (!c.ok) return upstreamFail(c);
          amount = c.data?.licensePrice || 0;
        }
        if (!amount) return err(400, 'zero_amount', 'הסכום לחיוב הוא 0');
        if (b.expected_amount_agorot != null && parseInt(b.expected_amount_agorot, 10) !== amount) {
          return err(409, 'amount_mismatch', `הסכום בפועל (${amount}) שונה מהסכום הצפוי`);
        }

        const payload = {
          payments: [{ clientId: client.id, clubId: actualClubId, amount, paymentType: 1, creditCardNumber: ccNum, expDate: exp, cvv, personalId: "" }],
          purchaseItems: [{ transactionType: 1, itemType, clientId: client.id, clubId: actualClubId, price: amount, qty: 1, totalPrice: amount }],
          IsAdminUser: true, clientId: client.id, clubId: actualClubId, amount
        };
        if (itemType === 2) payload.purchaseItems[0].moneyValue = amount;
        if (itemType === 1) Object.assign(payload.purchaseItems[0], dates);

        const p = await upstream('/Client/AdminPurchase', { method: 'POST', body: payload });
        const ok = !!(p.ok && p.data && p.data.isSuccess);
        const msg = ok ? 'הצלחה' : String(p.data?.message || 'שגיאה בחיוב');
        const clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim();
        let period = dates || {};
        if (itemType === 6) {
          let cur = client.licenceExp ? new Date(client.licenceExp) : new Date();
          if (isNaN(cur)) cur = new Date();
          const next = new Date(cur); next.setFullYear(next.getFullYear() + 1);
          period = { startDate: cur.toISOString(), endDate: next.toISOString() };
        }
        await logPurchase(env, {
          clubId, clientId: client.id, amountAgorot: amount, success: ok, message: msg,
          clientName, personalId: client.personalId || '', clientPhone: client.phone || null,
          itemType, startDate: period.startDate, endDate: period.endDate, cardLast4: ccNum.slice(-4),
          source: 'api', apiKeyName: row.key_name || String(row.key_id)
        });

        return json({ success: ok, purchase: { client_id: client.id, type: b.type, amount_agorot: amount, message: msg } }, ok ? 200 : 402);
      }
    }

    // ---------- מסופים ----------
    if (parts[0] === 'terminals') {
      const listTerminals = async () => {
        const r = await upstream('/Terminal');
        return r.ok ? { list: toList(r.data) } : { fail: upstreamFail(r) };
      };

      if (method === 'GET' && parts.length === 1) {
        const d = need('terminals:read'); if (d) return d;
        const t = await listTerminals(); if (t.fail) return t.fail;
        return json({ success: true, terminals: t.list });
      }

      if (method === 'GET' && parts[1] === 'logs' && parts.length === 2) {
        const d = need('terminals:read', 'history:terminals'); if (d) return d;
        const r = await queryTerminalLogs(env, { clubId }, filters());
        if (q.get('resolve_clients') !== '0') await resolveTerminalClients(env, r.logs);
        return json({ success: true, ...r });
      }

      const terminalId = parts[1];
      if (terminalId && (parts[2] === 'status' || parts[2] === 'action') && parts.length === 3) {
        const t = await listTerminals(); if (t.fail) return t.fail;
        const term = t.list.find(x => String(x.id) === String(terminalId));
        if (!term) return err(404, 'not_found', 'מסוף לא נמצא');

        if (method === 'GET' && parts[2] === 'status') {
          const d = need('terminals:read'); if (d) return d;
          const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 3000);
          let alive = false;
          try {
            const r = await upstream('/api/v1/Terminal/TerminalPing', { method: 'POST', signal: ctrl.signal, body: { terminalId: term.id, targetId: term.hardwareId, actionName: 'action', data: '' } });
            alive = !!(r.ok && r.data && r.data.isAlive);
          } catch (e) {}
          clearTimeout(timer);
          return json({ success: true, terminal_id: term.id, name: term.name, is_alive: alive });
        }

        if (method === 'POST' && parts[2] === 'action') {
          const d = need('terminals:control'); if (d) return d;
          const b = await readBody() || {};
          const allowed = ['openGate', 'reload', 'reboot', 'checkUpdates'];
          if (!allowed.includes(b.action)) return err(400, 'invalid_action', `action חייב להיות אחד מ: ${allowed.join(', ')}`);
          const r = await upstream('/Terminal/TerminalAction', { method: 'POST', body: { terminalId: term.id, targetId: term.hardwareId, actionName: b.action, data: '' } });
          await logTerminalAction(env, {
            clubId, username: row.target_username, terminalId: term.id, terminalName: term.name || null,
            action: b.action, success: r.ok, source: 'api', apiKeyName: row.key_name || String(row.key_id)
          });
          return r.ok ? json({ success: true, terminal_id: term.id, action: b.action }) : upstreamFail(r);
        }
      }
    }

    return err(404, 'not_found', 'נתיב לא נמצא. ראו את התיעוד: /mikve/docs/api.md');
  } catch (e) {
    return err(500, 'internal_error', e.message || 'שגיאה פנימית');
  }
}
