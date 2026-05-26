const BASE_URL = "https://prod.xn--8dbba8a7b.com";

export async function getValidToken(params, env) {
  const authId = `${params.user}_${params.club}`;
  const now = Math.floor(Date.now() / 1000);

  // בדיקה אם יש טוקן שמור בתוקף במסד הנתונים
  const dbRecord = await env.DB.prepare("SELECT token FROM tokens WHERE auth_id = ? AND expires_at > ?")
    .bind(authId, now)
    .first();

  let token = dbRecord ? dbRecord.token : null;

  // אימות מול שרת היעד אם יש טוקן
  if (token) {
    const res = await fetch(`${BASE_URL}/Club/GetCurrent`, {
      method: 'GET',
      headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club }
    });
    if (!res.ok) token = null;
  }

  // אם אין טוקן או שפג תוקפו - מבצעים התחברות
  if (!token) {
    const res = await fetch(`${BASE_URL}/Account`, {
      method: "POST",
      headers: { "clubExternalId": params.club, "Content-Type": "application/json" },
      body: JSON.stringify({ username: params.user, password: params.pass, externalClubId: params.club })
    });
    
    if (!res.ok) throw new Error("פרטי התחברות שגויים מול המערכת");
    
    const data = await res.json();
    token = data.token;

    // שמירת הטוקן החדש ב-D1 (תוקף ל-24 שעות)
    const expiresAt = now + 86400;
    await env.DB.prepare("INSERT OR REPLACE INTO tokens (auth_id, token, expires_at) VALUES (?, ?, ?)")
      .bind(authId, token, expiresAt)
      .run();
  }

  return token;
}
