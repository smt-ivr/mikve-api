const BASE_URL = "https://prod.xn--8dbba8a7b.com";

function cleanText(text) {
  return text ? text.replace(/[\.\-]/g, ' ').trim() : "";
}

function formatDateIL(dateString) {
  if (!dateString) return null;
  const utcDate = new Date(dateString);
  if (isNaN(utcDate.getTime())) return null;
  const ilDate = new Date(utcDate.toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
  return { 
    year: ilDate.getFullYear(), 
    formatted: `${String(ilDate.getDate()).padStart(2, '0')}/${String(ilDate.getMonth() + 1).padStart(2, '0')}/${ilDate.getFullYear()}` 
  };
}

export async function processIvrFlow(clientData, params, token, env) {
  const { main_menu, cc_number, cc_exp, cc_cvv } = params;
  const actualClubId = clientData.clubId;
  const actualClientId = clientData.id;

  // ------------------------------------------------------------------
  // שלב 0: הקראת נתונים ובחירת תפריט ראשי
  // ------------------------------------------------------------------
  if (!main_menu) {
    const balanceInShekels = (clientData.lastBalance || 0) / 100; 
    let subEndParts = [`t-לא נמצא תוקף למנוי במערכת`];
    
    const subDate = formatDateIL(clientData.subscriptionEndDate);
    if (subDate) subEndParts = subDate.year >= 2124 ? [`t-תוקף המנוי שלכם הוא ללא הגבלה`] : [`t-תוקף המנוי שלכם הוא עד`, `dateH-${subDate.formatted}`];

    const licDate = formatDateIL(clientData.licenceExp);
    let licExpParts = [];
    if (licDate) licExpParts = licDate.year >= 2124 ? [`t-ותוקף הרישיון הוא ללא הגבלה`] : [`t-ותוקף הרישיון שלכם הוא עד`, `dateH-${licDate.formatted}`];

    let ttsParts = [
      `t-שלום`, `t-${cleanText(`${clientData.firstName} ${clientData.lastName}`)}`,
      `t-היתרה המעודכנת שלך היא`, `n-${balanceInShekels}`, `t-שקלים`,
      ...subEndParts, ...licExpParts,
      `t-לטעינת פעימות הקישו 1.t-לחידוש מנוי חודשי הקישו 2`
    ];

    return `read=${ttsParts.join(".")}=main_menu,,1,,,NO,,,,12,,,,,no`;
  }

  // ------------------------------------------------------------------
  // שלב 1: טעינת פעימות (הוספה והפחתה דינמית)
  // ------------------------------------------------------------------
  if (main_menu === "1") {
    // משיכת חוקי ההטענה של הקבוצה
    const groupRes = await fetch(`${BASE_URL}/Group`, {
      method: 'GET',
      headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club }
    });
    const groupsRaw = await groupRes.json();
    const groups = Array.isArray(groupsRaw) ? groupsRaw : (groupsRaw.data || []);
    const clientGroup = groups.find(g => g.id === clientData.groupId) || {};
    
    const minAmountAgorot = clientGroup.minimumAmountToCharge != null ? clientGroup.minimumAmountToCharge : 3000;
    const stepAmountAgorot = clientGroup.stepAmountToCharge != null ? clientGroup.stepAmountToCharge : 600;
    
    const minAmount = minAmountAgorot / 100;
    const stepAmount = stepAmountAgorot / 100;

    let currentAmount = minAmount;
    let isAccepted = false;
    let stepIndex = 1;

    // חישוב הסכום הדינמי על פי משתני העבר (ללא בקשת אותו משתנה פעמיים!)
    while (true) {
      const stepVal = params[`peima_step_${stepIndex}`];
      if (!stepVal) break; // הגענו לשלב שעוד לא נשאל
      
      if (stepVal === '1') {
        isAccepted = true; // הלקוח אישר את הסכום
        break;
      } else if (stepVal === '2') {
        currentAmount += stepAmount;
      } else if (stepVal === '3') {
        currentAmount -= stepAmount;
        if (currentAmount < minAmount) currentAmount = minAmount; // לא נותן לרדת מהמינימום
      }
      stepIndex++;
    }

    // אם הלקוח טרם אישר סופית, מבקשים את המשתנה הבא בתור
    if (!isAccepted) {
      return `read=t-הסכום לתשלום הוא.n-${currentAmount}.t-שקלים.t-לאישור ומעבר לתשלום הקישו 1.t-להוספת.n-${stepAmount}.t-שקלים הקישו 2.t-להפחתת.n-${stepAmount}.t-שקלים הקישו 3=peima_step_${stepIndex},,1,,,NO,,,,,,,,,no`;
    }

    // אם אושר - עוברים לגביית אשראי
    if (!cc_number) return `read=m-1422=cc_number,,16,,,NO,,,,,,,,,no`;
    if (!cc_exp) return `read=m-1424=cc_exp,,4,,,NO,,,,,,,,,no`;
    if (!cc_cvv) return `read=m-1428=cc_cvv,,4,,,NO,,,,,,,,,no`;

    const finalAmountAgorot = currentAmount * 100;
    const paymentPayload = {
      payments: [{ clientId: actualClientId, clubId: actualClubId, amount: finalAmountAgorot, paymentType: 1, creditCardNumber: cc_number, expDate: cc_exp, cvv: cc_cvv, personalId: "" }],
      purchaseItems: [{ transactionType: 1, itemType: 2, clientId: actualClientId, clubId: actualClubId, moneyValue: finalAmountAgorot, price: finalAmountAgorot, qty: 1, totalPrice: finalAmountAgorot }],
      IsAdminUser: true, clientId: actualClientId, clubId: actualClubId, amount: finalAmountAgorot
    };

    return await executePayment(paymentPayload, finalAmountAgorot, "פעימות", params, actualClientId, token, env);
  }

  // ------------------------------------------------------------------
  // שלב 2: חידוש מנוי חודשי
  // ------------------------------------------------------------------
  if (main_menu === "2") {
    // משיכת פרטי חידוש מנוי
    const subRes = await fetch(`${BASE_URL}/GetRenewSubscriptionStartAndEndDatesAndPrice/${actualClientId}`, {
      method: 'POST',
      headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club, "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    if (!subRes.ok) return `id_list_message=t-שגיאה בשליפת נתוני המנוי`;
    const subData = await subRes.json();

    const priceAgorot = subData.price || 0;
    const priceShekels = priceAgorot / 100;
    const fromDate = formatDateIL(subData.fromDate);
    const toDate = formatDateIL(subData.toDate);

    if (!params.sub_confirm) {
      return `read=t-לחידוש מנוי מ.dateH-${fromDate ? fromDate.formatted : ""}.t-עד.dateH-${toDate ? toDate.formatted : ""}.t-בסך.n-${priceShekels}.t-שקלים.t-לאישור ומעבר לתשלום הקישו 1=sub_confirm,,1,,,NO,,,,,,,,,no`;
    }

    if (params.sub_confirm !== '1') {
       return `id_list_message=t-הפעולה בוטלה`;
    }

    // אם אושר - עוברים לגביית אשראי
    if (!cc_number) return `read=m-1422=cc_number,,16,,,NO,,,,,,,,,no`;
    if (!cc_exp) return `read=m-1424=cc_exp,,4,,,NO,,,,,,,,,no`;
    if (!cc_cvv) return `read=m-1428=cc_cvv,,4,,,NO,,,,,,,,,no`;

    const paymentPayload = {
      payments: [{ clientId: actualClientId, clubId: actualClubId, amount: priceAgorot, paymentType: 1, creditCardNumber: cc_number, expDate: cc_exp, cvv: cc_cvv, personalId: "" }],
      purchaseItems: [{ transactionType: 1, itemType: 1, clientId: actualClientId, clubId: actualClubId, startDate: subData.fromDate, endDate: subData.toDate, price: priceAgorot, qty: 1, totalPrice: priceAgorot }],
      IsAdminUser: true, clientId: actualClientId, clubId: actualClubId, amount: priceAgorot
    };

    return await executePayment(paymentPayload, priceAgorot, "מנוי חודשי", params, actualClientId, token, env);
  }

  // במקרה של בחירה שגויה בתפריט הראשי
  return `id_list_message=t-בחירה שגויה`;
}

// ------------------------------------------------------------------
// פונקציית עזר: ביצוע התשלום מול ה-API ושמירת הלוגים
// ------------------------------------------------------------------
async function executePayment(paymentPayload, amountAgorot, actionName, params, actualClientId, token, env) {
  const amountShekels = amountAgorot / 100;
  
  const payReq = await fetch(`${BASE_URL}/Client/AdminPurchase`, {
    method: 'POST',
    headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club, "Content-Type": "application/json" },
    body: JSON.stringify(paymentPayload)
  });

  const payRes = await payReq.json();
  
  // כתיבה לטבלת הלוגים ב-D1
  const logMsg = payRes.isSuccess ? "הצלחה" : (payRes.message || "שגיאה בחיוב");
  await env.DB.prepare("INSERT INTO charge_logs (club_id, client_id, amount, status, response_msg) VALUES (?, ?, ?, ?, ?)")
    .bind(params.club, actualClientId, amountShekels, payRes.isSuccess ? 'SUCCESS' : 'FAILED', logMsg)
    .run();

  // הודעת סיום למערכת (ללא בקשת משתנה נוסף כדי שהמערכת תעבור ל-go_to הבא)
  if (payRes.isSuccess) {
    return `id_list_message=t-בוצע בהצלחה תשלום.t-עבור.${actionName}.t-על סך.n-${amountShekels}.t-שקלים`;
  } else {
    return `id_list_message=t-התשלום נכשל`;
  }
}
