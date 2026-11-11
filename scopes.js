// scopes.js - הגדרת הרשאות (scopes) ל-API הציבורי

export const SCOPES = [
  { id: 'history:purchases', group: 'היסטוריה', label: 'היסטוריית רכישות: מי רכש, מה, מתי וכמה' },
  { id: 'history:terminals', group: 'היסטוריה', label: 'היסטוריית מסופים: מי פתח, איזה מסוף ומתי' },
  { id: 'history:account',   group: 'היסטוריה', label: 'היסטוריית שינויים בחשבון: מי הוסיף/מחק אשראי, מי הפעיל/ביטל חידוש אוטומטי' },
  { id: 'club:read',         group: 'מערכת',   label: 'צפייה בפרטי המערכת והקבוצות' },
  { id: 'clients:read',      group: 'לקוחות',  label: 'צפייה ברשימת לקוחות ופרטי לקוח' },
  { id: 'clients:write',     group: 'לקוחות',  label: 'עדכון פרטי לקוח' },
  { id: 'cards:read',        group: 'לקוחות',  label: 'צפייה בכרטיסי אשראי שמורים (מוסתרים)' },
  { id: 'purchases:read',    group: 'רכישות',  label: 'צפייה בהיסטוריית חיובים ומחירי חידוש' },
  { id: 'purchases:write',   group: 'רכישות',  label: 'ביצוע חיוב / רכישה' },
  { id: 'terminals:read',    group: 'מסופים',  label: 'צפייה במסופים, סטטוס ויומן פעולות' },
  { id: 'terminals:control', group: 'מסופים',  label: 'שליחת פקודות למסוף (פתיחת דלת וכו׳)' },
];

export const ALL_SCOPE_IDS = SCOPES.map(s => s.id);

// ממיר מחרוזת/מערך להרשאות תקינות בלבד. '*' = גישה מלאה
export function parseScopes(value) {
  let list = Array.isArray(value) ? value : String(value || '').split(',');
  list = list.map(s => String(s).trim()).filter(Boolean);
  if (list.includes('*')) return ['*'];
  return [...new Set(list.filter(s => ALL_SCOPE_IDS.includes(s)))];
}

export function expandScopes(list) {
  return list.includes('*') ? [...ALL_SCOPE_IDS] : list;
}

// ההרשאות שמשתמש רשאי להעניק למפתחות שלו
export function userAllowedScopes(user) {
  if (user.is_admin) return [...ALL_SCOPE_IDS];
  return expandScopes(parseScopes(user.api_scopes));
}

// ההרשאות בפועל של מפתח = חיתוך בין הרשאות המפתח להרשאות הנוכחיות של בעליו
export function effectiveKeyScopes(keyScopes, user) {
  const allowed = new Set(userAllowedScopes(user));
  return expandScopes(parseScopes(keyScopes)).filter(s => allowed.has(s));
}
