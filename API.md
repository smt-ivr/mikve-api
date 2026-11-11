# Mikve API – תיעוד מלא (v1)

> מסמך זה מיועד גם למפתחים וגם להעברה לכלי AI (ChatGPT / Claude וכו') כדי שיכתבו קוד מול ה-API.
> כל הבקשות והתשובות הן JSON בקידוד UTF-8.

## בסיס

```
Base URL: {{BASE_URL}}
```

## אימות (Authentication)

כל בקשה חייבת לכלול מפתח API שנוצר בממשק הניהול (לשונית "מפתחות API").
המפתח מתחיל ב-`mk_live_` ומוצג **פעם אחת בלבד** בעת היצירה.

שתי דרכים שקולות לשלוח את המפתח:

```
Authorization: Bearer mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

או

```
X-API-Key: mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- כל מפתח משויך ל**מערכת אחת** (מועדון / Club) – כל הנתונים שמוחזרים שייכים למערכת זו בלבד.
- אין לחשוף את המפתח בקוד צד-לקוח (דפדפן / אפליקציה). השתמשו בו רק מצד שרת.
- ניתן לבטל מפתח בכל רגע מהממשק; ביטול חל מיידית.

## הרשאות (Scopes)

לכל מפתח יש רשימת הרשאות. בקשה לנתיב שדורש הרשאה שאין למפתח תחזיר `403 insufficient_scope`.

| Scope | תיאור |
|---|---|
| `club:read` | צפייה בפרטי המערכת והקבוצות |
| `clients:read` | צפייה ברשימת לקוחות ופרטי לקוח |
| `clients:write` | עדכון פרטי לקוח |
| `cards:read` | צפייה בכרטיסי אשראי שמורים (מספרים מוסתרים) |
| `purchases:read` | צפייה בהיסטוריית חיובים ומחירי חידוש מנוי |
| `purchases:write` | ביצוע חיוב / רכישה בכרטיס אשראי |
| `terminals:read` | צפייה במסופים, סטטוס חיבור ויומן פעולות |
| `terminals:control` | שליחת פקודות למסוף (פתיחת דלת, ריענון, הפעלה מחדש) |
| `*` | גישה מלאה – כל ההרשאות |

ההרשאות בפועל של מפתח הן החיתוך בין מה שנבחר ביצירתו לבין מה שמנהל המערכת מאשר כרגע לחשבון.
ניתן לבדוק את ההרשאות בפועל בכל עת עם `GET /me`.

## מבנה תשובות

הצלחה:

```json
{ "success": true, "...": "..." }
```

שגיאה:

```json
{ "success": false, "error": { "code": "insufficient_scope", "message": "למפתח זה אין הרשאה: purchases:write" } }
```

| HTTP | code | משמעות |
|---|---|---|
| 400 | `invalid_body`, `invalid_type`, `invalid_card`, `invalid_amount`, `invalid_action`, `missing_client_id`, `zero_amount` | קלט שגוי |
| 401 | `missing_api_key`, `invalid_api_key` | מפתח חסר / שגוי / בוטל |
| 402 | – | החיוב נדחה (`success: false` עם הודעה ב-`purchase.message`) |
| 403 | `insufficient_scope` | אין הרשאה לנתיב |
| 404 | `not_found` | משאב / נתיב לא קיים |
| 409 | `amount_mismatch` | הסכום בפועל שונה מ-`expected_amount_agorot` |
| 500 | `internal_error` | שגיאה פנימית |
| 502 | `upstream_error` | שגיאה ממערכת הניהול שמאחורי ה-API |

**סכומים:** כל השדות שמסתיימים ב-`_agorot` הם באגורות (₪1 = 100). בהיסטוריית החיובים (`/purchases`) השדה `amount` הוא בשקלים.

---

## נתיבים

### GET /me
מידע על המפתח הנוכחי. לא דורש הרשאה.

```json
{
  "success": true,
  "key": { "name": "אתר הזמנות", "scopes": ["clients:read", "purchases:read"] },
  "system": { "id": 12, "label": "מקווה מרכז", "club_id": "abc123" }
}
```

---

### GET /club
`club:read` – פרטי המערכת (שם, מחיר רישיון `licensePrice` באגורות וכו').

```json
{ "success": true, "club": { "id": 1, "name": "...", "licensePrice": 5000, "...": "..." } }
```

### GET /groups
`club:read` – קבוצות הלקוחות. כל קבוצה כוללת בין היתר `minimumAmountToCharge` ו-`stepAmountToCharge` (באגורות) לטעינת "פעימות".

```json
{ "success": true, "groups": [ { "id": 3, "name": "...", "minimumAmountToCharge": 3000, "stepAmountToCharge": 600 } ] }
```

---

### GET /clients
`clients:read` – רשימת לקוחות.

פרמטרי Query (כולם אופציונליים):

| פרמטר | תיאור |
|---|---|
| `phone` | סינון לפי טלפון (ספרות בלבד, מתעלם מאפסים מובילים) |
| `personal_id` | סינון לפי תעודת זהות |
| `search` | חיפוש חופשי בשם / טלפון / ת"ז / מייל |
| `limit` | מספר תוצאות (ברירת מחדל 100, מקסימום 500) |
| `offset` | דילוג לצורך עימוד |

```json
{
  "success": true, "total": 1, "limit": 100, "offset": 0,
  "clients": [ { "id": 555, "firstName": "ישראל", "lastName": "ישראלי", "phone": "0501234567", "personalId": "012345678", "groupId": 3, "clubId": 1, "...": "..." } ]
}
```

### GET /clients/{id}
`clients:read` – פרטי לקוח מלאים (כולל יתרה, מנוי, `autoRenewSubscription` וכו' – כפי שמוחזר ממערכת הניהול).

```json
{ "success": true, "client": { "id": 555, "firstName": "ישראל", "...": "..." } }
```

### PATCH /clients/{id}
`clients:write` – עדכון שדות של לקוח. שולחים רק את השדות לשינוי; השרת ממזג אותם עם הנתונים הקיימים.
אין לשנות את `id`.

בקשה:

```json
{ "phone": "0529999999", "autoRenewSubscription": true }
```

תשובה:

```json
{ "success": true, "client": { "id": 555, "phone": "0529999999", "...": "..." } }
```

### GET /clients/{id}/credit-cards
`cards:read` – כרטיסי אשראי שמורים של הלקוח. מספרי כרטיס מוסתרים (`****1234`) ושדות CVV מוסרים.

```json
{ "success": true, "credit_cards": [ { "id": 9, "creditCardNumber": "****1234", "expDate": "1228" } ] }
```

### GET /clients/{id}/subscription-renewal
`purchases:read` – תאריכי ומחיר חידוש המנוי הבא של הלקוח.

```json
{ "success": true, "renewal": { "from_date": "2026-12-01T00:00:00", "to_date": "2026-12-31T00:00:00", "price_agorot": 25000, "raw": { } } }
```

---

### GET /purchases
`purchases:read` – היסטוריית חיובים (מהטלפון ומה-API) של המערכת, מהחדש לישן.

| פרמטר | תיאור |
|---|---|
| `limit` | ברירת מחדל 100, מקסימום 500 |

```json
{
  "success": true,
  "purchases": [ { "id": 101, "club_id": "abc123", "client_id": 555, "amount": 30, "status": "SUCCESS", "response_msg": "הצלחה", "api_phone": "0501234567", "client_name": "ישראל ישראלי", "personal_id": "012345678" } ]
}
```

`status` הוא `SUCCESS` או `FAILED`. בחיובים שבוצעו דרך ה-API השדה `api_phone` יהיה `API:<שם המפתח>`.

### POST /purchases
`purchases:write` – ביצוע חיוב בכרטיס אשראי.

| שדה | חובה | תיאור |
|---|---|---|
| `client_id` | כן | מזהה הלקוח |
| `type` | כן | `credit` – טעינת פעימות/יתרה, `subscription` – חידוש מנוי, `license` – חידוש רישיון |
| `amount_agorot` | ל-`credit` בלבד | הסכום באגורות. ל-`subscription`/`license` הסכום נקבע אוטומטית ע"י המערכת |
| `expected_amount_agorot` | לא | אם נשלח והסכום בפועל שונה – החיוב לא יבוצע (409). מומלץ ל-`subscription`/`license` |
| `card.number` | כן | מספר כרטיס |
| `card.exp` | כן | תוקף בפורמט `MMYY` |
| `card.cvv` | כן | 3–4 ספרות |

בקשה:

```json
{
  "client_id": 555,
  "type": "credit",
  "amount_agorot": 3000,
  "card": { "number": "4580000000000000", "exp": "1228", "cvv": "123" }
}
```

תשובה (הצלחה, HTTP 200):

```json
{ "success": true, "purchase": { "client_id": 555, "type": "credit", "amount_agorot": 3000, "message": "הצלחה" } }
```

תשובה (נדחה, HTTP 402):

```json
{ "success": false, "purchase": { "client_id": 555, "type": "credit", "amount_agorot": 3000, "message": "כרטיס לא תקין" } }
```

> פרטי כרטיס האשראי לא נשמרים בשרת ה-API ונשלחים ישירות למערכת הסליקה.
> חובה לשלוח בקשות אלו רק מצד שרת מאובטח (HTTPS).

---

### GET /terminals
`terminals:read` – רשימת מסופים (בקרי דלתות).

```json
{ "success": true, "terminals": [ { "id": 7, "name": "כניסה ראשית", "hardwareId": "XYZ", "...": "..." } ] }
```

### GET /terminals/{id}/status
`terminals:read` – בדיקה אם המסוף מחובר לרשת (פינג, עד 3 שניות).

```json
{ "success": true, "terminal_id": 7, "name": "כניסה ראשית", "is_alive": true }
```

### POST /terminals/{id}/action
`terminals:control` – שליחת פקודה למסוף.

| `action` | פעולה |
|---|---|
| `openGate` | פתיחת דלת פעם אחת |
| `reload` | ריענון המסוף |
| `reboot` | הפעלה מחדש |
| `checkUpdates` | בדיקת עדכונים |

```json
{ "action": "openGate" }
```

```json
{ "success": true, "terminal_id": 7, "action": "openGate" }
```

### GET /terminals/logs
`terminals:read` – יומן פקודות שנשלחו למסופים (מהטלפון ומה-API).

```json
{ "success": true, "logs": [ { "id": 1, "terminal_id": 7, "action_name": "openGate", "status": "SUCCESS", "api_phone": "0501234567", "timestamp": "2026-11-11 10:00:00" } ] }
```

---

## דוגמאות קוד

### curl

```bash
curl -H "Authorization: Bearer $MIKVE_API_KEY" "{{BASE_URL}}/clients?phone=0501234567"
```

```bash
curl -X POST -H "Authorization: Bearer $MIKVE_API_KEY" -H "Content-Type: application/json" \
  -d '{"action":"openGate"}' "{{BASE_URL}}/terminals/7/action"
```

### JavaScript (Node 18+)

```js
const BASE = "{{BASE_URL}}";
const KEY = process.env.MIKVE_API_KEY;

async function mikve(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message || data.purchase?.message || `HTTP ${res.status}`);
  return data;
}

const { clients } = await mikve("/clients?phone=0501234567");
const { client } = await mikve(`/clients/${clients[0].id}`);
```

### Python

```python
import os, requests

BASE = "{{BASE_URL}}"
H = {"Authorization": f"Bearer {os.environ['MIKVE_API_KEY']}"}

clients = requests.get(f"{BASE}/clients", params={"search": "כהן"}, headers=H).json()["clients"]
renewal = requests.get(f"{BASE}/clients/{clients[0]['id']}/subscription-renewal", headers=H).json()["renewal"]
```

## הנחיות לכלי AI

- השתמש רק בנתיבים המתועדים כאן; אין נתיבים נוספים.
- קרא קודם `GET /me` כדי לדעת אילו הרשאות זמינות למפתח, ואל תנסה נתיבים שאין להם הרשאה.
- שמור את המפתח במשתנה סביבה (`MIKVE_API_KEY`) ולעולם לא בקוד צד-לקוח.
- המר סכומים לאגורות (×100) לפני שליחה ל-`amount_agorot`.
- לפני חיוב `subscription`/`license` קרא את המחיר (`/clients/{id}/subscription-renewal` או `/club`) ושלח אותו ב-`expected_amount_agorot`.
- טפל בשגיאות לפי `error.code`.
