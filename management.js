const BASE_URL = "https://prod.xn--8dbba8a7b.com";

// משיכת פרמטרים רגילה
function getAllParams(params, prefix) {
  let arr = [];
  let i = 1;
  while(params[`${prefix}_${i}`] !== undefined) {
    arr.push(params[`${prefix}_${i}`]);
    i++;
  }
  return arr;
}

// משיכת פרמטרים חכמה - מבודדת לפי מחזור הכניסה לתפריט (Cycle)
function getCycleParams(params, prefix, cycle) {
  let arr = [];
  let i = 1;
  while(params[`${prefix}_c${cycle}_${i}`] !== undefined) {
    arr.push(params[`${prefix}_c${cycle}_${i}`]);
    i++;
  }
  return arr;
}

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

// פונקציית עזר ליצירת התפריט הראשי והודעות חזרה
function getMainMenuPrompt(clientData, currentCard, nextIdx, apiResponsePrefix = null) {
  if (!currentCard) {
    let msg = `t-לא קיים אמצעי תשלום במערכת.t-להוספת כרטיס אשראי הקישו 1`;
    if (apiResponsePrefix) {
       return `id_list_message=${apiResponsePrefix}&read=${msg}=mgmt_main_${nextIdx},,1,,,NO,,,,1*,,,,,no`;
    }
    return `read=${msg}=mgmt_main_${nextIdx},,1,,,NO,,,,1*,,,,,no`;
  }

  let statusParts = [];
  if (clientData.autoRenewSubscription) statusParts.push("t-מנוי חודשי");
  if (clientData.autoRenewLicence) statusParts.push("t-רישיון שנתי");
  if (clientData.autoRenewCredit) {
    statusParts.push(`t-פעימות על סך.n-${(clientData.autoRenewCreditAmount || 0) / 100}.t-שקלים`);
  }

  let renewText = statusParts.length > 0
    ? `t-מוגדר חידוש אוטומטי עבור.${statusParts.join(".m-1182.")}`
    : `t-לא מוגדר חידוש אוטומטי במערכת`;

  let msg = `t-במערכת שמור אמצעי תשלום המסתיים בספרות.d-${currentCard.fourDigits}.${renewText}.t-לניהול אמצעי התשלום הקישו 1.t-לניהול החידוש האוטומטי הקישו 2`;
  
  if (apiResponsePrefix) {
    return `id_list_message=${apiResponsePrefix}&read=${msg}=mgmt_main_${nextIdx},,1,,,NO,,,,12*,,,,,no`;
  }
  return `read=${msg}=mgmt_main_${nextIdx},,1,,,NO,,,,12*,,,,,no`;
}

export async function processManagementFlow(clientData, params, token, env) {
  const clientId = clientData.id;

  // משיכת סטטוס כרטיס אשראי עדכני בכל כניסה
  const cardsRes = await fetch(`${BASE_URL}/CreditCard/GetByClientId/${clientId}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const cards = await cardsRes.json();
  const hasCard = Array.isArray(cards) && cards.length > 0;
  let currentCard = hasCard ? cards[0] : null;

  const mgmt_mains = getAllParams(params, 'mgmt_main');
  const cycle = mgmt_mains.length; // מייצג באיזה מחזור של התפריט הראשי אנחנו

  // אם עוד לא נכנסנו לתפריט מעולם, או שהמשתמש הקיש כוכבית בתפריט הראשי
  if (cycle === 0 || mgmt_mains[cycle - 1] === '*') {
    return getMainMenuPrompt(clientData, currentCard, cycle + 1);
  }

  const mgmtMainVal = mgmt_mains[cycle - 1];

  // ------------------------------------------------------------------
  // נתיב 1: ניהול אמצעי תשלום
  // ------------------------------------------------------------------
  if (mgmtMainVal === '1') {
    const mgmt_pays = getCycleParams(params, 'mgmt_pay', cycle);
    const mgmt_add_confirms = getCycleParams(params, 'mgmt_add_confirm', cycle);
    const mgmt_del_confirms = getCycleParams(params, 'mgmt_del_confirm', cycle);
    const new_cc_numbers = getCycleParams(params, 'new_cc_number', cycle);
    const new_cc_exps = getCycleParams(params, 'new_cc_exp', cycle);
    const new_cc_cvvs = getCycleParams(params, 'new_cc_cvv', cycle);

    // חזרה לתפריט ראשי בכל הקשת כוכבית
    if (mgmt_pays.length > 0 && mgmt_pays[mgmt_pays.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);
    if (mgmt_add_confirms.length > 0 && mgmt_add_confirms[mgmt_add_confirms.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);
    if (mgmt_del_confirms.length > 0 && mgmt_del_confirms[mgmt_del_confirms.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);
    if (new_cc_numbers.length > 0 && new_cc_numbers[new_cc_numbers.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);
    if (new_cc_exps.length > 0 && new_cc_exps[new_cc_exps.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);
    if (new_cc_cvvs.length > 0 && new_cc_cvvs[new_cc_cvvs.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);

    if (mgmt_pays.length === 0 && hasCard) {
        return `read=t-להוספת כרטיס אשראי חדש הקישו 1.t-למחיקת אמצעי התשלום הקיים הקישו 2.t-לחזרה הקישו כוכבית=mgmt_pay_c${cycle}_1,,1,,,NO,,,,12*,,,,,no`;
    }

    const action = hasCard ? mgmt_pays[mgmt_pays.length - 1] : '1';

    if (action === '1') {
        if (mgmt_add_confirms.length === 0) {
            return `read=t-שימו לב, יצירת כרטיס חדש תמחק אמצעי תשלום קודמים השמורים במערכת.t-הזנת האשראי משמשת לשמירת הכרטיס בלבד, והמערכת לא תבצע שום חיוב כעת.t-לאישור ומעבר להזנת אשראי הקישו 1.t-לחזרה הקישו כוכבית=mgmt_add_confirm_c${cycle}_1,,1,,,NO,,,,1*,,,,,no`;
        }

        // מספר כרטיס
        if (new_cc_numbers.length === 0) {
             return `read=m-1422=new_cc_number_c${cycle}_1,,16,,,NO,,,,,,,,,no`;
        }
        const lastCcNum = new_cc_numbers[new_cc_numbers.length - 1];
        if (!isValidLuhn(lastCcNum)) {
             return `read=t-מספר כרטיס שגוי.m-1422=new_cc_number_c${cycle}_${new_cc_numbers.length + 1},,16,,,NO,,,,,,,,,no`;
        }

        // תוקף כרטיס
        if (new_cc_exps.length === 0) {
             return `read=m-1424=new_cc_exp_c${cycle}_1,,4,,,NO,,,,,,,,,no`;
        }
        const lastCcExp = new_cc_exps[new_cc_exps.length - 1];
        if (!isValidExp(lastCcExp)) {
             return `read=t-תוקף שגוי.m-1424=new_cc_exp_c${cycle}_${new_cc_exps.length + 1},,4,,,NO,,,,,,,,,no`;
        }

        // CVV
        if (new_cc_cvvs.length === 0) {
             return `read=m-1428=new_cc_cvv_c${cycle}_1,,4,3,,NO,,,,,,,,,no`;
        }
        const lastCcCvv = new_cc_cvvs[new_cc_cvvs.length - 1];
        if (lastCcCvv.length < 3) {
             return `read=m-1428=new_cc_cvv_c${cycle}_${new_cc_cvvs.length + 1},,4,3,,NO,,,,,,,,,no`;
        }

        // אם הכל תקין, שומרים אמצעי תשלום
        const expMonth = parseInt(lastCcExp.substring(0, 2), 10);
        const expYear = 2000 + parseInt(lastCcExp.substring(2, 4), 10);
        const fourDigits = lastCcNum.substring(lastCcNum.length - 4);

        const newCardPayload = {
            clientId: clientId,
            isEditMode: true,
            cardNumber: lastCcNum,
            expMonth: expMonth,
            expYear: expYear,
            cvv: lastCcCvv,
            personalId: clientData.personalId || "",
            name: `${clientData.firstName || ''} ${clientData.lastName || ''}`.trim(),
            fourDigits: fourDigits,
            paymentMethod: 1
        };

        const saveReq = await fetch(`${BASE_URL}/CreditCard`, {
            method: 'POST',
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(newCardPayload)
        });

        if (saveReq.ok) {
            return getMainMenuPrompt(clientData, { fourDigits }, cycle + 1, "t-אמצעי התשלום נשמר בהצלחה במערכת");
        } else {
            return getMainMenuPrompt(clientData, currentCard, cycle + 1, "t-שגיאה בשמירת אמצעי התשלום");
        }

    } else if (action === '2') {
        if (mgmt_del_confirms.length === 0) {
            return `read=t-האם אתם בטוחים שברצונכם למחוק את אמצעי התשלום.t-לאישור הקישו 1.t-לחזרה הקישו כוכבית=mgmt_del_confirm_c${cycle}_1,,1,,,NO,,,,1*,,,,,no`;
        }

        const delReq = await fetch(`${BASE_URL}/CreditCard/${currentCard.id}`, {
            method: 'DELETE',
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (delReq.status === 204 || delReq.ok) {
            return getMainMenuPrompt(clientData, null, cycle + 1, "t-אמצעי התשלום נמחק בהצלחה");
        } else {
            return getMainMenuPrompt(clientData, currentCard, cycle + 1, "t-שגיאה במחיקת אמצעי התשלום");
        }
    }
  }
  // ------------------------------------------------------------------
  // נתיב 2: ניהול החידוש האוטומטי
  // ------------------------------------------------------------------
  else if (mgmtMainVal === '2') {
    const mgmt_renews = getCycleParams(params, 'mgmt_renew', cycle);
    
    if (mgmt_renews.length > 0 && mgmt_renews[mgmt_renews.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);

    if (mgmt_renews.length === 0) {
        return `read=t-לניהול חידוש אוטומטי למנוי הקישו 1.t-לניהול חידוש אוטומטי לרישיון הקישו 2.t-לניהול טעינת פעימות אוטומטית הקישו 3.t-לחזרה לתפריט הקודם הקישו כוכבית=mgmt_renew_c${cycle}_1,,1,,,NO,,,,123*,,,,,no`;
    }

    const mgmtRenewVal = mgmt_renews[mgmt_renews.length - 1];

    if (mgmtRenewVal === '1') { // מנוי חודשי
        const confirms = getCycleParams(params, 'mgmt_renew_sub_confirm', cycle);
        if (confirms.length > 0 && confirms[confirms.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);
        
        if (confirms.length === 0) {
            const statusStr = clientData.autoRenewSubscription ? "מופעל" : "כבוי";
            const actStr = clientData.autoRenewSubscription ? "לביטול" : "להפעלה";
            return `read=t-חידוש מנוי אוטומטי כעת.t-${statusStr}.t-${actStr}.t-הקישו 1.t-לחזרה הקישו כוכבית=mgmt_renew_sub_confirm_c${cycle}_1,,1,,,NO,,,,1*,,,,,no`;
        }
        
        if (confirms[0] === '1') {
            const patchPayload = { ...clientData, autoRenewSubscription: !clientData.autoRenewSubscription };
            const patchReq = await fetch(`${BASE_URL}/Client/${clientId}`, {
                method: 'PATCH',
                headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(patchPayload)
            });

            if (patchReq.ok) clientData.autoRenewSubscription = !clientData.autoRenewSubscription;

            const resultText = patchReq.ok
                ? `t-חידוש מנוי אוטומטי ${clientData.autoRenewSubscription ? "הופעל" : "בוטל"} בהצלחה`
                : `t-שגיאה בעדכון ההגדרות`;

            return getMainMenuPrompt(clientData, currentCard, cycle + 1, resultText);
        }

    } else if (mgmtRenewVal === '2') { // רישיון שנתי
        const confirms = getCycleParams(params, 'mgmt_renew_lic_confirm', cycle);
        if (confirms.length > 0 && confirms[confirms.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);

        if (confirms.length === 0) {
            const statusStr = clientData.autoRenewLicence ? "מופעל" : "כבוי";
            const actStr = clientData.autoRenewLicence ? "לביטול" : "להפעלה";
            return `read=t-חידוש רישיון אוטומטי כעת.t-${statusStr}.t-${actStr}.t-הקישו 1.t-לחזרה הקישו כוכבית=mgmt_renew_lic_confirm_c${cycle}_1,,1,,,NO,,,,1*,,,,,no`;
        }

        if (confirms[0] === '1') {
            const patchPayload = { ...clientData, autoRenewLicence: !clientData.autoRenewLicence };
            const patchReq = await fetch(`${BASE_URL}/Client/${clientId}`, {
                method: 'PATCH',
                headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(patchPayload)
            });

            if (patchReq.ok) clientData.autoRenewLicence = !clientData.autoRenewLicence;

            const resultText = patchReq.ok
                ? `t-חידוש רישיון אוטומטי ${clientData.autoRenewLicence ? "הופעל" : "בוטל"} בהצלחה`
                : `t-שגיאה בעדכון ההגדרות`;

            return getMainMenuPrompt(clientData, currentCard, cycle + 1, resultText);
        }

    } else if (mgmtRenewVal === '3') { // פעימות
        const confirms = getCycleParams(params, 'mgmt_renew_cred_confirm', cycle);
        const amounts = getCycleParams(params, 'mgmt_cred_amount', cycle);
        
        if (confirms.length > 0 && confirms[confirms.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);
        if (amounts.length > 0 && amounts[amounts.length - 1] === '*') return getMainMenuPrompt(clientData, currentCard, cycle + 1);

        if (confirms.length === 0) {
            if (clientData.autoRenewCredit) {
                const statusStr = `מופעלת על סך.n-${(clientData.autoRenewCreditAmount || 0) / 100}.t-שקלים`;
                return `read=t-טעינת פעימות אוטומטית כעת.t-${statusStr}.t-לביטול הקישו 1.t-לשינוי סכום הקישו 2.t-לחזרה הקישו כוכבית=mgmt_renew_cred_confirm_c${cycle}_1,,1,,,NO,,,,12*,,,,,no`;
            } else {
                return `read=t-טעינת פעימות אוטומטית כעת כבויה.t-להפעלה הקישו 1.t-לחזרה הקישו כוכבית=mgmt_renew_cred_confirm_c${cycle}_1,,1,,,NO,,,,1*,,,,,no`;
            }
        }
        
        const lastConfirm = confirms[confirms.length - 1];
        
        if (clientData.autoRenewCredit) { // טעינה כעת מופעלת
            if (lastConfirm === '1') {
                // ביטול פעימות
                const patchPayload = { ...clientData, autoRenewCredit: false, autoRenewCreditAmount: null };
                const patchReq = await fetch(`${BASE_URL}/Client/${clientId}`, {
                    method: 'PATCH',
                    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify(patchPayload)
                });

                if (patchReq.ok) {
                    clientData.autoRenewCredit = false;
                    clientData.autoRenewCreditAmount = null;
                }

                const resultText = patchReq.ok
                    ? `t-טעינת פעימות אוטומטית בוטלה בהצלחה`
                    : `t-שגיאה בעדכון ההגדרות`;

                return getMainMenuPrompt(clientData, currentCard, cycle + 1, resultText);
            } else if (lastConfirm === '2') {
                // שינוי סכום (Type: Number)
                if (amounts.length === 0) {
                    return `read=t-נא להקיש את הסכום בשקלים לטעינה חודשית, ובסיום סולמית=mgmt_cred_amount_c${cycle}_1,,4,,,Number`;
                }
                const amountStr = amounts[amounts.length - 1];
                const amountAgorot = parseInt(amountStr, 10) * 100;
                
                if (isNaN(amountAgorot) || amountAgorot <= 0) {
                    return `read=t-סכום שגוי.t-נא להקיש את הסכום בשקלים לטעינה חודשית, ובסיום סולמית=mgmt_cred_amount_c${cycle}_${amounts.length + 1},,4,,,Number`;
                }
                
                const patchPayload = { ...clientData, autoRenewCredit: true, autoRenewCreditAmount: amountAgorot };
                const patchReq = await fetch(`${BASE_URL}/Client/${clientId}`, {
                    method: 'PATCH',
                    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify(patchPayload)
                });

                if (patchReq.ok) clientData.autoRenewCreditAmount = amountAgorot;

                const resultText = patchReq.ok
                    ? `t-סכום טעינת פעימות אוטומטית עודכן בהצלחה לסך.n-${amountStr}.t-שקלים`
                    : `t-שגיאה בעדכון ההגדרות`;

                return getMainMenuPrompt(clientData, currentCard, cycle + 1, resultText);
            }
        } else { // טעינה כעת כבויה
            if (lastConfirm === '1') {
                // הפעלת פעימות וקבלת סכום (Type: Number)
                if (amounts.length === 0) {
                    return `read=t-נא להקיש את הסכום בשקלים לטעינה חודשית, ובסיום סולמית=mgmt_cred_amount_c${cycle}_1,,4,,,Number`;
                }
                const amountStr = amounts[amounts.length - 1];
                const amountAgorot = parseInt(amountStr, 10) * 100;
                
                if (isNaN(amountAgorot) || amountAgorot <= 0) {
                    return `read=t-סכום שגוי.t-נא להקיש את הסכום בשקלים לטעינה חודשית, ובסיום סולמית=mgmt_cred_amount_c${cycle}_${amounts.length + 1},,4,,,Number`;
                }
                
                const patchPayload = { ...clientData, autoRenewCredit: true, autoRenewCreditAmount: amountAgorot };
                const patchReq = await fetch(`${BASE_URL}/Client/${clientId}`, {
                    method: 'PATCH',
                    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify(patchPayload)
                });

                if (patchReq.ok) {
                    clientData.autoRenewCredit = true;
                    clientData.autoRenewCreditAmount = amountAgorot;
                }

                const resultText = patchReq.ok
                    ? `t-טעינת פעימות אוטומטית הופעלה בהצלחה על סך.n-${amountStr}.t-שקלים`
                    : `t-שגיאה בעדכון ההגדרות`;

                return getMainMenuPrompt(clientData, currentCard, cycle + 1, resultText);
            }
        }
    }
  }

  return "&";
}
