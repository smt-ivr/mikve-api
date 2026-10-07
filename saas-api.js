// saas-api.js
export async function handleSaasRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/saas', '');

  // פונקציית עזר להחזרת JSON
  const jsonResponse = (data, status = 200) => 
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  if (request.method === 'POST' && path === '/register') {
    const { email, password } = await request.json();
    try {
      await env.DB.prepare("INSERT INTO saas_users (email, password) VALUES (?, ?)")
        .bind(email, password) // בסביבת ייצור מומלץ להצפין את הסיסמה (Hash)
        .run();
      return jsonResponse({ success: true, message: "המשתמש נוצר בהצלחה" });
    } catch (e) {
      return jsonResponse({ success: false, message: "שגיאה ביצירת משתמש, ייתכן שהמייל כבר קיים" }, 400);
    }
  }

  if (request.method === 'POST' && path === '/login') {
    const { email, password } = await request.json();
    const user = await env.DB.prepare("SELECT id, email, max_tokens FROM saas_users WHERE email = ? AND password = ?")
      .bind(email, password)
      .first();

    if (user) {
      // כאן ניצור סשן או נחזיר מזהה משתמש פשוט לצורך הדגמה
      return jsonResponse({ success: true, user });
    }
    return jsonResponse({ success: false, message: "פרטי התחברות שגויים" }, 401);
  }

  // מכאן ואילך דורש מזהה משתמש (לצורך הדגמה, עובר בהדר Authorization)
  const userId = request.headers.get("Authorization");
  if (!userId) return jsonResponse({ success: false, message: "חסר זיהוי משתמש" }, 401);

  if (request.method === 'GET' && path === '/tokens') {
    const { results } = await env.DB.prepare("SELECT id, token, target_club_id, label, created_at FROM saas_tokens WHERE user_id = ?")
      .bind(userId)
      .all();
    return jsonResponse({ success: true, tokens: results });
  }

  if (request.method === 'POST' && path === '/tokens') {
    const { club_id, username, password, label } = await request.json();
    
    // בדיקת מגבלת כמות טוקנים למשתמש
    const userRow = await env.DB.prepare("SELECT max_tokens FROM saas_users WHERE id = ?").bind(userId).first();
    const { results: existingTokens } = await env.DB.prepare("SELECT id FROM saas_tokens WHERE user_id = ?").bind(userId).all();
    
    if (existingTokens.length >= userRow.max_tokens) {
      return jsonResponse({ success: false, message: "הגעת למגבלת הטוקנים בחשבונך. צור קשר להגדלת החבילה." }, 403);
    }

    // יצירת טוקן ייחודי עבור ימות המשיח
    const newToken = crypto.randomUUID().replace(/-/g, '');

    await env.DB.prepare("INSERT INTO saas_tokens (user_id, token, target_club_id, target_username, target_password, label) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(userId, newToken, club_id, username, password, label || "מערכת ללא שם")
      .run();

    return jsonResponse({ success: true, token: newToken });
  }

  if (request.method === 'DELETE' && path.startsWith('/tokens/')) {
    const tokenId = path.split('/')[2];
    await env.DB.prepare("DELETE FROM saas_tokens WHERE id = ? AND user_id = ?")
      .bind(tokenId, userId)
      .run();
    return jsonResponse({ success: true, message: "הטוקן נמחק" });
  }

  return jsonResponse({ success: false, message: "נתיב לא נמצא" }, 404);
}
