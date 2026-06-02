const BASE_URL = "https://prod.xn--8dbba8a7b.com";

// הפונקציה עודכנה כדי לסנן תווים מיוחדים שימות המשיח לא יודע להקריא
function cleanText(text) {
  return text ? text.replace(/[\.\-\"\'\,\:\;\!\?\(\)\[\]]/g, ' ').replace(/\s+/g, ' ').trim() : "";
}

function formatDateIL(dateString) {
  if (!dateString) return null;
  const datePart = dateString.split('T')[0]; 
  if (!datePart) return null;
  const parts = datePart.split('-'); 
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parts[1];
  const day = parts[2];
  return { 
    year: year, 
    formatted: `${day}/${month}/${year}` 
  };
}

// משיכת כל המשתנים מאותו סוג לפי סדר
function getAllParams(params, prefix) {
  let arr = [];
  let i = 1;
  while(params[`${prefix}_${i}`] !== undefined) {
    arr.push(params[`${prefix}_${i}`]);
    i++;
  }
  return arr;
}

// אלגוריתם Luhn לבדיקת תקינות ספרות כרטיס אשראי
function isValidLuhn(ccNum) {
  if (!ccNum || ccNum.length < 8 || ccNum.length > 19 || !/^\d+$/.test(ccNum)) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = ccNum.length - 1; i >= 0; i--) {
    let digit = parseInt(ccNum.charAt(i), 10);
    if (shouldDouble) {
      if ((digit *= 2) > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return (sum % 10) === 0;
}

// בדיקת תקינות תוקף האשראי
function isValidExp(exp) {
  if (!exp || exp.length !== 4 || !/^\d+$/.test(exp)) return false;
  const month = parseInt(exp.substring(0, 2), 10);
  const year = parseInt(exp.substring(2, 4), 10);
  if (month < 1 || month > 12) return false;

  const now = new Date();
  const currentYear = parseInt(now.getFullYear().toString().substring(2, 4), 10);
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear) return false;
  if (year === currentYear && month < currentMonth) return false;
  return true;
}

export async function processIvrFlow(clientData, params, token, env) {
  const actualClubId = clientData.clubId;
  const actualClientId = clientData.id;

  const main_menus = getAllParams(params, 'main_menu');
  const peima_steps = getAllParams(params, 'peima_step');
  const sub_confirms = getAllParams(params, 'sub_confirm');
  const lic_confirms = getAllParams(params, 'lic_confirm'); // נוסף עבור חידוש רישיון
  const cc_numbers = getAllParams(params, 'cc_number');
  const cc_exps = getAllParams(params, 'cc_exp');
  const cc_cvvs = getAllParams(params, 'cc_cvv');
  const fail_retries = getAllParams(params, 'fail_retry');

  if (fail_retries.includes('*')) return "&";

  // ------------------------------------------------------------------
  // שלב 0: תפריט ראשי
  // ------------------------------------------------------------------
  let validMainMenus = main_menus.filter(v => v === '1' || v === '2' || v === '3');
  let isMainMenuSelected = validMainMenus.length > 0;
  let selectedMenu = isMainMenuSelected ? validMainMenus[validMainMenus.length - 1] : null;

  if (!isMainMenuSelected) {
    const nextIdx = main_menus.length + 1;
    const balanceInShekels = (clientData.lastBalance || 0) / 100; 
    let subEndParts = [`t-לא נמצא תוקף למנוי במערכת`];
    
    const subDate = formatDateIL(clientData.subscriptionEndDate);
    if (subDate) subEndParts = subDate.year >= 2124 ? [`t-תוקף המנוי שלכם הוא ללא הגבלה`] : [`t-תוקף המנוי שלכם הוא עד`, `dateH-${subDate.formatted}`];

    const licDate = formatDateIL(clientData.licenceExp);
    let licExpParts = [];
    if (licDate) licExpParts = licDate.year >= 2124 ? [`t-ותוקף הרישיון הוא ללא הגבלה`] : [`t-ותוקף הרישיון שלכם הוא עד`, `dateH-${licDate.formatted}`];

    let ttsParts = [
      `t-שלום`, `t-${cleanText(`${clientData.firstName} ${clientData.lastName}`)}`,
      `t-יתרת הפעימות שלך היא`, `n-${balanceInShekels}`, `t-שקלים`,
      ...subEndParts, ...licExpParts,
      `t-לטעינת פעימות הקישו 1.t-לחידוש מנוי חודשי הקישו 2.t-לחידוש רישיון שנתי הקישו 3`
    ];

    return `read=${ttsParts.join(".")}=main_menu_${nextIdx},,1,,,NO,,,,123*,,,,,no`;
  }

  // ------------------------------------------------------------------
  // שלב 1: אישור סכום
  // ------------------------------------------------------------------
  const amountCancels = cc_numbers.filter(v => v === '*').length + fail_retries.filter(v => v === '2').length;
  let isAmountAccepted = false;
  let finalAmountAgorot = 0;
  let paymentItemType = 0;
  let subDates = {};

  if (selectedMenu === '1') {
    paymentItemType = 2; // פעימות
    
    if (peima_steps.includes('*')) return "&"; 

    let peimaAcceptances = peima_steps.filter(v => v === '1').length;
    isAmountAccepted = peimaAcceptances > amountCancels;

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

    let currentPeimaAmountShekels = minAmount;
    for (let val of peima_steps) {
      if (val === '2') currentPeimaAmountShekels += stepAmount;
      if (val === '3') {
        currentPeimaAmountShekels -= stepAmount;
        if (currentPeimaAmountShekels < minAmount) currentPeimaAmountShekels = minAmount;
      }
    }

    if (!isAmountAccepted) {
      const nextIdx = peima_steps.length + 1;
      let promptMsg = `read=t-הסכום לתשלום הוא.n-${currentPeimaAmountShekels}.t-שקלים.t-לאישור ומעבר לתשלום הקישו 1.t-להוספת.n-${stepAmount}.t-שקלים הקישו 2`;
      let allowedKeys = "12*";
      if (currentPeimaAmountShekels > minAmount) {
        promptMsg += `.t-להפחתת.n-${stepAmount}.t-שקלים הקישו 3`;
        allowedKeys = "123*";
      }
      promptMsg += `=peima_step_${nextIdx},,1,,,NO,,,,${allowedKeys},,,,,no`;
      return promptMsg;
    }
    finalAmountAgorot = currentPeimaAmountShekels * 100;

  } else if (selectedMenu === '2') {
    paymentItemType = 1; // חידוש חודשי
    
    if (sub_confirms.includes('*')) return "&"; 

    let subAcceptances = sub_confirms.filter(v => v === '1').length;
    isAmountAccepted = subAcceptances > amountCancels;

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

    if (!isAmountAccepted) {
      const nextIdx = sub_confirms.length + 1;
      return `read=t-חידוש מנוי מתאריך.dateH-${fromDate ? fromDate.formatted : ""}.t-עד תאריך.dateH-${toDate ? toDate.formatted : ""}.t-בסך.n-${priceShekels}.t-שקלים.t-לאישור ומעבר לתשלום הקישו 1=sub_confirm_${nextIdx},,1,,,NO,,,,1*,,,,,no`;
    }
    finalAmountAgorot = priceAgorot;
    subDates = { startDate: subData.fromDate, endDate: subData.toDate };

  } else if (selectedMenu === '3') {
    paymentItemType = 6; // רישיון שנתי
    
    if (lic_confirms.includes('*')) return "&"; 

    let licAcceptances = lic_confirms.filter(v => v === '1').length;
    isAmountAccepted = licAcceptances > amountCancels;

    // שליפת פרטי המועדון למשיכת מחיר הרישיון
    const clubRes = await fetch(`${BASE_URL}/Club/GetCurrent`, {
      method: 'GET',
      headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club }
    });

    if (!clubRes.ok) return `id_list_message=t-שגיאה בשליפת נתוני המערכת`;
    const clubData = await clubRes.json();

    const priceAgorot = clubData.licensePrice || 0;
    const priceShekels = priceAgorot / 100;
    
    // חישוב תאריך התפוגה החדש - שנתים מהתאריך הקיים
    let currentLicDate = new Date();
    if (clientData.licenceExp) {
       const parsed = new Date(clientData.licenceExp);
       if (!isNaN(parsed.getTime())) currentLicDate = parsed;
    }
    
    const newLicDate = new Date(currentLicDate);
    newLicDate.setFullYear(newLicDate.getFullYear() + 1);
    
    // עיצוב התאריך עבור ימות המשיח (DD/MM/YYYY)
    const formattedNewLicDate = `${newLicDate.getDate()}/${newLicDate.getMonth() + 1}/${newLicDate.getFullYear()}`;

    if (!isAmountAccepted) {
      const nextIdx = lic_confirms.length + 1;
      return `read=t-הרשיון הוא.t-שנתי.t-הרישיון יחודש עד תאריך.dateH-${formattedNewLicDate}.t-בסך.n-${priceShekels}.t-שקלים.t-לאישור ומעבר לתשלום הקישו 1=lic_confirm_${nextIdx},,1,,,NO,,,,1*,,,,,no`;
    }
    finalAmountAgorot = priceAgorot;
  }

  // ------------------------------------------------------------------
  // שלב 2: קליטת אשראי 
  // ------------------------------------------------------------------
  const ccNumCancels = cc_exps.filter(v => v === '*').length + fail_retries.length;
  let validCcNumbers = cc_numbers.filter(v => v !== '*' && isValidLuhn(v));
  let isCcNumValid = validCcNumbers.length > ccNumCancels;
  let currentCcNumber = isCcNumValid ? validCcNumbers[validCcNumbers.length - 1] : null;

  if (!isCcNumValid) {
    const nextIdx = cc_numbers.length + 1;
    let msg = "m-1422";
    if (cc_numbers.length > 0) {
      const lastEntered = cc_numbers[cc_numbers.length - 1];
      if (lastEntered !== '*' && !isValidLuhn(lastEntered)) {
        msg = "t-מספר כרטיס שגוי.m-1422";
      }
    }
    return `read=${msg}=cc_number_${nextIdx},,16,,,NO,,,,,,,,,no`;
  }

  const ccExpCancels = cc_cvvs.filter(v => v === '*').length + fail_retries.length;
  let validCcExps = cc_exps.filter(v => v !== '*' && isValidExp(v));
  let isCcExpValid = validCcExps.length > ccExpCancels;
  let currentCcExp = isCcExpValid ? validCcExps[validCcExps.length - 1] : null;

  if (!isCcExpValid) {
    const nextIdx = cc_exps.length + 1;
    let msg = "m-1424";
    if (cc_exps.length > 0) {
      const lastEntered = cc_exps[cc_exps.length - 1];
      if (lastEntered !== '*' && !isValidExp(lastEntered)) {
        msg = "t-תוקף שגוי.m-1424";
      }
    }
    return `read=${msg}=cc_exp_${nextIdx},,4,,,NO,,,,,,,,,no`;
  }

  const ccCvvCancels = fail_retries.length;
  let validCcCvvs = cc_cvvs.filter(v => v !== '*' && v.length >= 3);
  let isCcCvvValid = validCcCvvs.length > ccCvvCancels;
  let currentCcCvv = isCcCvvValid ? validCcCvvs[validCcCvvs.length - 1] : null;

  if (isCcCvvValid) {
    const paymentPayload = {
      payments: [{ clientId: actualClientId, clubId: actualClubId, amount: finalAmountAgorot, paymentType: 1, creditCardNumber: currentCcNumber, expDate: currentCcExp, cvv: currentCcCvv, personalId: "" }],
      purchaseItems: [{
        transactionType: 1,
        itemType: paymentItemType,
        clientId: actualClientId,
        clubId: actualClubId,
        price: finalAmountAgorot,
        qty: 1,
        totalPrice: finalAmountAgorot
      }],
      IsAdminUser: true, clientId: actualClientId, clubId: actualClubId, amount: finalAmountAgorot
    };

    if (paymentItemType === 2) {
      paymentPayload.purchaseItems[0].moneyValue = finalAmountAgorot;
    } else if (paymentItemType === 1) {
      paymentPayload.purchaseItems[0].startDate = subDates.startDate;
      paymentPayload.purchaseItems[0].endDate = subDates.endDate;
    }

    let actionName = "";
    if (paymentItemType === 2) actionName = "פעימות";
    else if (paymentItemType === 1) actionName = "מנוי חודשי";
    else if (paymentItemType === 6) actionName = "חידוש רישיון";

    const payRes = await executePayment(paymentPayload, finalAmountAgorot, params, actualClientId, token, env);

    if (payRes.isSuccess) {
      return `id_list_message=t-בוצע בהצלחה תשלום.t-עבור.${actionName}.t-על סך.n-${finalAmountAgorot / 100}.t-שקלים`;
    } else {
      const nextRetryIdx = fail_retries.length + 1;
      
      // השמעת הודעת השגיאה המפורטת כשהיא נקייה מתווים מיוחדים
      let retryMsg = `read=t-התשלום נכשל.t-השגיאה מהסליקה היא.t-${payRes.message}.t-להקשת אשראי מחדש הקישו 1`;
      
      let allowed = "1*";
      if (paymentItemType === 2) {
        retryMsg += `.t-לבחירת סכום אחר הקישו 2`;
        allowed = "12*";
      }
      retryMsg += `.t-לחזרה לתפריט הראשי הקישו כוכבית=fail_retry_${nextRetryIdx},,1,,,NO,,,,${allowed},,,,,no`;
      return retryMsg;
    }
  } else {
    const nextIdx = cc_cvvs.length + 1;
    return `read=m-1428=cc_cvv_${nextIdx},,4,3,,NO,,,,,,,,,no`;
  }
}

async function executePayment(paymentPayload, amountAgorot, params, actualClientId, token, env) {
  const amountShekels = amountAgorot / 100;
  const payReq = await fetch(`${BASE_URL}/Client/AdminPurchase`, {
    method: 'POST',
    headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club, "Content-Type": "application/json" },
    body: JSON.stringify(paymentPayload)
  });

  const payRes = await payReq.json();
  
  // במקרה של כשלון מתבצע ניקוי לתשובה מחברת הסליקה
  let cleanedMessage = "שגיאה לא ידועה";
  if (!payRes.isSuccess) {
    cleanedMessage = cleanText(payRes.message || "שגיאה בחיוב");
  }

  const logMsg = payRes.isSuccess ? "הצלחה" : (payRes.message || "שגיאה בחיוב");
  await env.DB.prepare("INSERT INTO charge_logs (club_id, client_id, amount, status, response_msg) VALUES (?, ?, ?, ?, ?)")
    .bind(params.club, actualClientId, amountShekels, payRes.isSuccess ? 'SUCCESS' : 'FAILED', logMsg)
    .run();

  return { isSuccess: payRes.isSuccess, message: cleanedMessage };
}
