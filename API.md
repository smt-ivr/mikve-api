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
| `history:purchases` | **היסטוריית רכישות בלבד** – מי רכש, מה, מתי, כמה ובאיזה ערוץ |
| `history:terminals` | **היסטוריית מסופים בלבד** – מי פתח איזה מסוף ומתי |
| `history:account` | **היסטוריית שינויים בחשבון לקוח** – מי הוסיף/מחק כרטיס אשראי, מי הפעיל/ביטל חידוש אוטומטי |
| `club:read` | צפייה בפרטי המערכת והקבוצות |
| `clients:read` | צפייה ברשימת לקוחות ופרטי לקוח |
| `clients:write` | עדכון פרטי לקוח |
| `cards:read` | צפייה בכרטיסי אשראי שמורים (מספרים מוסתרים) |
| `purchases:read` | צפייה בהיסטוריית חיובים ומחירי חידוש מנוי |
| `purchases:write` | ביצוע חיוב / רכישה בכרטיס אשראי |
| `terminals:read` | צפייה במסופים, סטטוס חיבור ויומן פעולות |
| `terminals:control` | שליחת פקודות למסוף (פתיחת דלת, ריענון, הפעלה מחדש) |
| `*` | גישה מלאה – כל ההרשאות |

> מפתח עם הרשאות `history:*` בלבד יכול **רק לקרוא היסטוריה** – אין לו גישה לרשימת הלקוחות, לחיובים או לשליטה במסופים.

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

## היסטוריית פעולות

כל פעולה שבוצעה דרך המערכת – בטלפון (ימות המשיח) או דרך ה-API – נרשמת ומוחזרת כאן עם כל הפרטים.

### פרמטרי סינון משותפים (Query)

| פרמטר | תיאור |
|---|---|
| `from` / `to` | טווח תאריכים `YYYY-MM-DD` (כולל), או זמן ISO מלא. הזמנים ב-UTC |
| `status` | `SUCCESS` / `FAILED` |
| `source` | `phone` (ימות המשיח) / `api` |
| `phone` | טלפון המתקשר / הלקוח |
| `search` | חיפוש חופשי (שם, ת"ז, טלפון, מזהה) |
| `limit` | ברירת מחדל 100, מקסימום 1000 |
| `offset` | עימוד |

### GET /history/purchases
`history:purchases` (או `purchases:read`) – **מי רכש ומה**.

סינונים נוספים: `client_id`, `personal_id`, `type` (`credit` / `subscription` / `license`).

```json
{
  "success": true,
  "total": 1, "limit": 100, "offset": 0,
  "total_success_agorot": 3000,
  "purchases": [
    {
      "id": 101,
      "date": "2026-11-11T09:30:12Z",
      "system": { "label": "מקווה מרכז", "club_id": "abc123" },
      "client": { "id": "555", "name": "ישראל ישראלי", "personal_id": "012345678", "phone": "0501234567" },
      "item": { "type": "subscription", "name": "חידוש מנוי חודשי", "start_date": "2026-12-01T00:00:00", "end_date": "2026-12-31T00:00:00" },
      "amount": { "agorot": 25000, "shekels": 250 },
      "payment": { "status": "SUCCESS", "success": true, "message": "הצלחה", "card_last4": "1234" },
      "source": { "channel": "phone", "caller_phone": "0501234567", "api_key": null }
    }
  ]
}
```

| שדה | תיאור |
|---|---|
| `client.id` | מזהה הלקוח במערכת הניהול |
| `client.personal_id` | תעודת זהות |
| `item.type` | `credit` = טעינת פעימות, `subscription` = חידוש מנוי חודשי, `license` = חידוש רישיון שנתי |
| `item.start_date` / `item.end_date` | תקופת המנוי / הרישיון שנרכשו (ב-`credit` – `null`) |
| `amount` | סכום החיוב באגורות ובשקלים |
| `payment.card_last4` | 4 ספרות אחרונות של הכרטיס בלבד |
| `payment.message` | הודעת חברת הסליקה (בכישלון – סיבת הדחייה) |
| `source.channel` | `phone` – בוצע בטלפון, `api` – בוצע דרך מפתח API |
| `source.caller_phone` | הטלפון ממנו התקשרו (רק ב-`phone`) |
| `source.api_key` | שם המפתח שביצע (רק ב-`api`) |
| `total_success_agorot` | סכום כל החיובים המוצלחים שעונים לסינון |

> ברשומות ישנות (לפני עדכון המערכת) חלק מהשדות (`item`, `card_last4`, `client.phone`, `date`) עשויים להיות `null`.

### GET /history/terminals
`history:terminals` (או `terminals:read`) – **מי פתח, איזה מסוף ומתי**.

סינונים נוספים: `terminal_id`, `action` (`openGate` / `reload` / `reboot` / `checkUpdates`), `resolve_clients=0` לביטול זיהוי הלקוח.

```json
{
  "success": true,
  "total": 1, "limit": 100, "offset": 0,
  "logs": [
    {
      "id": 77,
      "date": "2026-11-11T18:02:44Z",
      "system": { "label": "מקווה מרכז", "club_id": "abc123" },
      "terminal": { "id": "7", "name": "כניסה ראשית" },
      "action": { "code": "openGate", "name": "פתיחת דלת" },
      "status": "SUCCESS", "success": true,
      "source": { "channel": "phone", "caller_phone": "0501234567", "api_key": null },
      "client": { "id": "555", "name": "ישראל ישראלי", "personal_id": "012345678", "phone": "0501234567", "matched_by": "caller_phone" }
    }
  ]
}
```

`client` מזוהה לפי מספר הטלפון שממנו התקשרו מול רשימת הלקוחות במערכת. אם לא נמצאה התאמה (או שהפעולה בוצעה דרך API) – `client` יהיה `null`.

### GET /history/account
`history:account` – **מי הוסיף כרטיס אשראי, מי מחק, ומי הפעיל או ביטל חידוש אוטומטי** (בטלפון בתפריט "ניהול אמצעי תשלום והוראות קבע", או דרך ה-API).

סינונים נוספים: `client_id`, `personal_id`, `event` – קוד אירוע מדויק או קידומת:

| `event` | משמעות |
|---|---|
| `card_added` | הוספת כרטיס אשראי |
| `card_deleted` | מחיקת כרטיס אשראי |
| `auto_renew_subscription_on` / `_off` | הפעלה / ביטול חידוש מנוי אוטומטי |
| `auto_renew_license_on` / `_off` | הפעלה / ביטול חידוש רישיון אוטומטי |
| `auto_credit_on` / `_off` | הפעלה / ביטול טעינת פעימות אוטומטית |
| `auto_credit_amount` | שינוי סכום טעינת פעימות אוטומטית |
| `client_updated` | עדכון פרטי לקוח אחרים (דרך API) |
| קידומות שימושיות | `card` (כל פעולות הכרטיס), `auto_renew` (מנוי + רישיון), `auto_credit` |

```json
{
  "success": true,
  "total": 2, "limit": 100, "offset": 0,
  "changes": [
    {
      "id": 12,
      "date": "2026-11-11T19:15:02Z",
      "system": { "label": "מקווה מרכז", "club_id": "abc123" },
      "client": { "id": "555", "name": "ישראל ישראלי", "personal_id": "012345678", "phone": "0501234567" },
      "event": { "code": "card_added", "name": "הוספת כרטיס אשראי", "enabled": null },
      "details": { "card_last4": "1234", "card_exp": "1228", "amount_agorot": null, "previous_amount_agorot": null, "fields": null },
      "status": "SUCCESS", "success": true, "message": null,
      "source": { "channel": "phone", "caller_phone": "0501234567", "api_key": null }
    },
    {
      "id": 13,
      "date": "2026-11-11T19:16:40Z",
      "system": { "label": "מקווה מרכז", "club_id": "abc123" },
      "client": { "id": "555", "name": "ישראל ישראלי", "personal_id": "012345678", "phone": "0501234567" },
      "event": { "code": "auto_credit_on", "name": "הפעלת טעינת פעימות אוטומטית", "enabled": true },
      "details": { "card_last4": null, "card_exp": null, "amount_agorot": 10000, "previous_amount_agorot": null, "fields": null },
      "status": "SUCCESS", "success": true, "message": null,
      "source": { "channel": "phone", "caller_phone": "0501234567", "api_key": null }
    }
  ]
}
```

| שדה | תיאור |
|---|---|
| `event.enabled` | `true` = הופעל, `false` = בוטל, `null` = לא רלוונטי (כרטיס / עדכון) |
| `details.card_last4` / `card_exp` | 4 ספרות אחרונות ותוקף (`MMYY`) של הכרטיס שנוסף / נמחק. מספר מלא ו-CVV לעולם לא נשמרים |
| `details.amount_agorot` | סכום טעינת הפעימות האוטומטית החדש |
| `details.previous_amount_agorot` | הסכום הקודם (בשינוי / ביטול) |
| `details.fields` | השדות שעודכנו ב-`client_updated` |
| `message` | סיבת הכישלון אם הפעולה נכשלה |
| `source` | כמו בשאר ההיסטוריה: `phone` + טלפון המתקשר, או `api` + שם המפתח |

> היומן הזה קיים מעכשיו והלאה – פעולות שבוצעו לפני העדכון לא מופיעות בו.

### GET /history
דורש לפחות אחת מההרשאות `history:purchases` / `history:terminals` / `history:account`. מחזיר את כל סוגי הפעולות שמותרים למפתח בציר זמן אחד, מהחדש לישן. מקבל את אותם פרמטרי סינון (ללא `offset`).

```json
{
  "success": true,
  "purchases_total": 120,
  "terminal_actions_total": 340,
  "account_changes_total": 25,
  "events": [
    { "kind": "terminal_action", "date": "2026-11-11T18:02:44Z", "...": "כמו ב-/history/terminals" },
    { "kind": "purchase", "date": "2026-11-11T09:30:12Z", "...": "כמו ב-/history/purchases" },
    { "kind": "account_change", "date": "2026-11-11T08:10:00Z", "...": "כמו ב-/history/account" }
  ]
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
`purchases:read` (או `history:purchases`) – זהה ל-`GET /history/purchases` (נשמר לתאימות).

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
`terminals:read` (או `history:terminals`) – זהה ל-`GET /history/terminals` (נשמר לתאימות).

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

### היסטוריית רכישות של החודש

```bash
curl -H "Authorization: Bearer $MIKVE_API_KEY" "{{BASE_URL}}/history/purchases?from=2026-11-01&to=2026-11-30&status=SUCCESS"
```

### מי הוסיף כרטיס אשראי השבוע

```bash
curl -H "Authorization: Bearer $MIKVE_API_KEY" "{{BASE_URL}}/history/account?event=card_added&from=2026-11-08"
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
- להיסטוריה השתמש ב-`/history/purchases` ו-`/history/terminals` עם `from`/`to`, ועבור על כל הדפים עם `offset` עד שמגיעים ל-`total`.
