export async function handleSaasRequest(request, env) {
  const url = new URL(request.url);
  const apiIndex = url.pathname.indexOf('/api');
  const path = apiIndex !== -1 ? url.pathname.substring(apiIndex + 4) : url.pathname;

  const jsonResponse = (data, status = 200) => 
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  if (request.method === 'POST' && path === '/register') {
    const { name, email, password } = await request.json();
    try {
      await env.DB.prepare("INSERT INTO saas_users (name, email, password) VALUES (?, ?, ?)").bind(name || "", email, password).run();
      return jsonResponse({ success: true, message: "המשתמש נוצר בהצלחה" });
    } catch (e) {
      return jsonResponse({ success: false, message: "שגיאה ביצירת משתמש ייתכן שהמייל כבר קיים" }, 400);
    }
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return jsonResponse({ success: false, message: "חסר זיהוי משתמש או פורמט שגוי" }, 401);
  }

  let email, password;
  try {
    const decoded = atob(authHeader.replace("Basic ", ""));
    [email, password] = decoded.split(':');
  } catch(e) {
    return jsonResponse({ success: false, message: "טוקן אימות לא חוקי" }, 401);
  }

  const currentUser = await env.DB.prepare("SELECT id, name, email, max_tokens, is_admin, can_view_history, can_use_payment, can_use_terminal FROM saas_users WHERE email = ? AND password = ?")
    .bind(email, password).first();

  if (!currentUser) {
    return jsonResponse({ success: false, message: "פרטי התחברות שגויים" }, 401);
  }

  if (request.method === 'GET' && path === '/me') {
    return jsonResponse({ success: true, user: currentUser });
  }

  if (request.method === 'GET' && path === '/tokens') {
    const { results } = await env.DB.prepare("SELECT id, token, target_club_id, label, created_at FROM saas_tokens WHERE user_id = ?").bind(currentUser.id).all();
    return jsonResponse({ success: true, tokens: results });
  }

  if (request.method === 'POST' && path === '/tokens') {
    const { club_id, username, password, label } = await request.json();
    
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

  if (request.method === 'DELETE' && path.startsWith('/tokens/')) {
    const tokenId = path.split('/')[2];
    await env.DB.prepare("DELETE FROM saas_tokens WHERE id = ? AND user_id = ?").bind(tokenId, currentUser.id).run();
    return jsonResponse({ success: true, message: "הטוקן נמחק בהצלחה" });
  }

  if (request.method === 'GET' && path === '/logs') {
    if (!currentUser.can_view_history && !currentUser.is_admin) {
      return jsonResponse({ success: false, message: "אין הרשאה לצפות בהיסטוריה" }, 403);
    }
    const query = `
      SELECT l.id, l.club_id, l.terminal_id, l.action_name, l.status, l.api_phone, l.timestamp, t.label 
      FROM terminal_logs l
      JOIN saas_tokens t ON l.club_id = t.target_club_id
      WHERE t.user_id = ?
      ORDER BY l.timestamp DESC LIMIT 100
    `;
    const { results } = await env.DB.prepare(query).bind(currentUser.id).all();
    return jsonResponse({ success: true, logs: results });
  }

  if (!currentUser.is_admin) {
     return jsonResponse({ success: false, message: "נתיב לא נמצא" }, 404);
  }

  if (request.method === 'GET' && path === '/users') {
    const { results } = await env.DB.prepare("SELECT id, name, email, max_tokens, is_admin, can_view_history, can_use_payment, can_use_terminal, created_at FROM saas_users").all();
    return jsonResponse({ success: true, users: results });
  }

  if (request.method === 'POST' && path === '/users') {
    const { name, email, password, max_tokens, can_view_history, can_use_payment, can_use_terminal } = await request.json();
    try {
      await env.DB.prepare("INSERT INTO saas_users (name, email, password, max_tokens, can_view_history, can_use_payment, can_use_terminal) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(name || "", email, password, max_tokens || 1, can_view_history ? 1 : 0, can_use_payment ? 1 : 0, can_use_terminal ? 1 : 0).run();
      return jsonResponse({ success: true, message: "הלקוח נוצר" });
    } catch (e) {
      return jsonResponse({ success: false, message: "שגיאה, ייתכן שהמייל קיים" }, 400);
    }
  }

  if (request.method === 'PATCH' && path.startsWith('/users/')) {
    const targetUserId = path.split('/')[2];
    const { name, max_tokens, can_view_history, can_use_payment, can_use_terminal } = await request.json();
    await env.DB.prepare("UPDATE saas_users SET name = ?, max_tokens = ?, can_view_history = ?, can_use_payment = ?, can_use_terminal = ? WHERE id = ?")
      .bind(name || "", max_tokens, can_view_history ? 1 : 0, can_use_payment ? 1 : 0, can_use_terminal ? 1 : 0, targetUserId).run();
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

  if (request.method === 'PATCH' && path.startsWith('/admin/tokens/')) {
    const parts = path.split('/');
    if (parts[3] === 'transfer') {
      const tokenId = parts[2];
      const { new_user_id } = await request.json();
      await env.DB.prepare("UPDATE saas_tokens SET user_id = ? WHERE id = ?").bind(new_user_id, tokenId).run();
      return jsonResponse({ success: true, message: "הטוקן הועבר בהצלחה" });
    }
  }

  return jsonResponse({ success: false, message: "נתיב לא נמצא" }, 404);
}
