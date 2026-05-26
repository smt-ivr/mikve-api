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
  const { menu_choice, pay_amount, cc_number, cc_exp, cc_cvv } = params;
  const actualClubId = clientData.clubId;
  const actualClientId = clientData.id;

  // שלב 0: הצגת נתונים ובחירת תפריט
  if (!menu_choice) {
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
      `t-למעבר לתפריט הטענת יתרה הקישו 1`
    ];

    return `read=${ttsParts.join(".")}=menu_choice,,1,,,NO,,,,1`;
  }

  // שלבים 1 עד 5: איסוף פרטי הטענה
  if (menu_choice === "1") {
    if (!pay_amount) return `read=t-נא להקיש את הסכום להטענה בשקלים, ובסיום סולמית=pay_amount,,4,,,NO,,,,`;
    if (!cc_number) return `read=t-נא להקיש את מספר כרטיס האשראי, ובסיום סולמית=cc_number,,16,,,NO,,,,`;
    if (!cc_exp) return `read=t-נא להקיש את תוקף הכרטיס, ארבע ספרות של חודש ושנה=cc_exp,,4,,,NO,,,,`;
    if (!cc_cvv) return `read=t-נא להקיש שלוש ספרות בגב הכרטיס, ובסיום סולמית=cc_cvv,,4,,,NO,,,,`;

    // ביצוע פעולת התשלום
    const amountAgorot = parseInt(pay_amount, 10) * 100;
    const paymentPayload = {
      payments: [{ clientId: actualClientId, clubId: actualClubId, amount: amountAgorot, paymentType: 1, creditCardNumber: cc_number, expDate: cc_exp, cvv: cc_cvv, personalId: "" }],
      purchaseItems: [{ transactionType: 1, itemType: 2, clientId: actualClientId, clubId: actualClubId, moneyValue: amountAgorot, price: amountAgorot, qty: 1, totalPrice: amountAgorot }],
      IsAdminUser: true, clientId: actualClientId, clubId: actualClubId, amount: amountAgorot
    };

    const payReq = await fetch(`${BASE_URL}/Client/AdminPurchase`, {
      method: 'POST',
      headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club, "Content-Type": "application/json" },
      body: JSON.stringify(paymentPayload)
    });

    const payRes = await payReq.json();
    
    // כתיבה לטבלת הלוגים ב-D1
    const logMsg = payRes.isSuccess ? "הצלחה" : (payRes.message || "שגיאה בחיוב");
    await env.DB.prepare("INSERT INTO charge_logs (club_id, client_id, amount, status, response_msg) VALUES (?, ?, ?, ?, ?)")
      .bind(params.club, actualClientId, pay_amount, payRes.isSuccess ? 'SUCCESS' : 'FAILED', logMsg)
      .run();

    if (payRes.isSuccess) {
      return `id_list_message=t-ההטענה בוצעה בהצלחה.t-סכום ההטענה הוא.n-${pay_amount}.t-שקלים.t-המשך יום נעים`;
    } else {
      return `id_list_message=t-שגיאה בביצוע התשלום.t-הכרטיס לא חויב.t-המשך יום נעים`;
    }
  }
}
