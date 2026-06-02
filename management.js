const BASE_URL = "https://prod.xn--8dbba8a7b.com";

function getAllParams(params, prefix) {
  let arr = [];
  let i = 1;
  while(params[`${prefix}_${i}`] !== undefined) {
    arr.push(params[`${prefix}_${i}`]);
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

export async function processManagementFlow(clientData, params, token, env) {
  const clientId = clientData.id;

  // 1. בדיקה אם קיים כרטיס אשראי ללקוח
  const cardsRes = await fetch(`${BASE_URL}/CreditCard/GetByClientId/${clientId}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const cards = await cardsRes.json();
  const hasCard = Array.isArray(cards) && cards.length > 0;
  const currentCard = hasCard ? cards[0] : null;

  const mgmt_mains = getAllParams(params, 'mgmt_main');
  const mgmt_pays = getAllParams(params, 'mgmt_pay');
  const mgmt_add_confirms = getAllParams(params, 'mgmt_add_confirm');
  const mgmt_del_confirms = getAllParams(params, 'mgmt_del_confirm');
  const mgmt_renews = getAllParams(params, 'mgmt_renew');
  
  const mgmt_renew_sub_confirms = getAllParams(params, 'mgmt_renew_sub_confirm');
  const mgmt_renew_lic_confirms = getAllParams(params, 'mgmt_renew_lic_confirm');
  const mgmt_renew_cred_confirms = getAllParams(params, 'mgmt_renew_cred_confirm');

  const new_cc_numbers = getAllParams(params, 'new_cc_number');
  const new_cc_exps = getAllParams(params, 'new_cc_exp');
  const new_cc_cvvs = getAllParams(params, 'new_cc_cvv');

  const isMgmtMain = mgmt_mains.length > 0 && mgmt_mains[mgmt_mains.length - 1] !== '*';
  const mgmtMainVal = isMgmtMain ? mgmt_mains[mgmt_mains.length - 1] : null;

  // ------------------------------------------------------------------
  // תפריט ניהול ראשי
  // ------------------------------------------------------------------
  if (!isMgmtMain) {
    const nextIdx = mgmt_mains.length + 1;
    if (!hasCard) {
      return `read=t-לא קיים אמצעי תשלום במערכת.t-להוספת כרטיס אשראי הקישו 1=mgmt_main_${nextIdx},,1,,,NO,,,,1*,,,,,no`;
    } else {
      let statusParts = [];
      if (clientData.autoRenewSubscription) statusParts.push("t-מנוי חודשי");
      if (clientData.autoRenewLicence) statusParts.push("t-רישיון שנתי");
      if (clientData.autoRenewCredit) statusParts.push("t-פעימות");

      let renewText = statusParts.length > 0
        ? `t-מוגדר חידוש אוטומטי עבור.${statusParts.join(".m-1182.")}`
        : `t-לא מוגדר חידוש אוטומטי במערכת`;

      let prompt = `read=t-במערכת שמור אמצעי תשלום המסתיים בספרות.d-${currentCard.fourDigits}.${renewText}.t-לניהול אמצעי התשלום הקישו 1.t-לניהול החידוש האוטומטי הקישו 2`;
      return `${prompt}=mgmt_main_${nextIdx},,1,,,NO,,,,12*,,,,,no`;
    }
  }

  // ------------------------------------------------------------------
  // נתיב 1: ניהול אמצעי תשלום
  // ------------------------------------------------------------------
  if (mgmtMainVal === '1') {
    const isMgmtPay = mgmt_pays.length > 0 && mgmt_pays[mgmt_pays.length - 1] !== '*';
    const mgmtPayVal = isMgmtPay ? mgmt_pays[mgmt_pays.length - 1] : null;

    if (!isMgmtPay && hasCard) {
      const nextIdx = mgmt_pays.length + 1;
      return `read=t-להוספת כרטיס אשראי חדש הקישו 1.t-למחיקת אמצעי התשלום הקיים הקישו 2=mgmt_pay_${nextIdx},,1,,,NO,,,,12*,,,,,no`;
    }

    const action = hasCard ? mgmtPayVal : '1'; 

    if (action === '1') { 
      const isAddConfirm = mgmt_add_confirms.length > 0 && mgmt_add_confirms[mgmt_add_confirms.length - 1] !== '*';
      if (!isAddConfirm) {
        const nextIdx = mgmt_add_confirms.length + 1;
        return `read=t-שימו לב, יצירת כרטיס חדש תמחק אמצעי תשלום קודמים השמורים במערכת.t-הזנת האשראי משמשת לשמירת הכרטיס בלבד, והמערכת לא תבצע שום חיוב כעת.t-לאישור ומעבר להזנת אשראי הקישו 1=mgmt_add_confirm_${nextIdx},,1,,,NO,,,,1*,,,,,no`;
      }

      let validCcNumbers = new_cc_numbers.filter(v => v !== '*' && isValidLuhn(v));
      let isCcNumValid = validCcNumbers.length > new_cc_exps.filter(v => v === '*').length;
      let currentCcNumber = isCcNumValid ? validCcNumbers[validCcNumbers.length - 1] : null;

      if (!isCcNumValid) {
        const nextIdx = new_cc_numbers.length + 1;
        let msg = "m-1422";
        if (new_cc_numbers.length > 0) {
          const last = new_cc_numbers[new_cc_numbers.length - 1];
          if (last !== '*' && !isValidLuhn(last)) msg = "t-מספר כרטיס שגוי.m-1422";
        }
        return `read=${msg}=new_cc_number_${nextIdx},,16,,,NO,,,,,,,,,no`;
      }

      let validCcExps = new_cc_exps.filter(v => v !== '*' && isValidExp(v));
      let isCcExpValid = validCcExps.length > new_cc_cvvs.filter(v => v === '*').length;
      let currentCcExp = isCcExpValid ? validCcExps[validCcExps.length - 1] : null;

      if (!isCcExpValid) {
        const nextIdx = new_cc_exps.length + 1;
        let msg = "m-1424";
        if (new_cc_exps.length > 0) {
          const last = new_cc_exps[new_cc_exps.length - 1];
          if (last !== '*' && !isValidExp(last)) msg = "t-תוקף שגוי.m-1424";
        }
        return `read=${msg}=new_cc_exp_${nextIdx},,4,,,NO,,,,,,,,,no`;
      }

      let validCcCvvs = new_cc_cvvs.filter(v => v !== '*' && v.length >= 3);
      let isCcCvvValid = validCcCvvs.length > 0;
      let currentCcCvv = isCcCvvValid ? validCcCvvs[validCcCvvs.length - 1] : null;

      if (!isCcCvvValid) {
        const nextIdx = new_cc_cvvs.length + 1;
        return `read=m-1428=new_cc_cvv_${nextIdx},,4,3,,NO,,,,,,,,,no`;
      }

      const expMonth = parseInt(currentCcExp.substring(0, 2), 10);
      const expYear = 2000 + parseInt(currentCcExp.substring(2, 4), 10);
      const fourDigits = currentCcNumber.substring(currentCcNumber.length - 4);

      const newCardPayload = {
        clientId: clientId,
        isEditMode: true,
        cardNumber: currentCcNumber,
        expMonth: expMonth,
        expYear: expYear,
        cvv: currentCcCvv,
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
        return `id_list_message=t-אמצעי התשלום נשמר בהצלחה במערכת`;
      } else {
        return `id_list_message=t-שגיאה בשמירת אמצעי התשלום`;
      }

    } else if (action === '2') { 
      const isDelConfirm = mgmt_del_confirms.length > 0 && mgmt_del_confirms[mgmt_del_confirms.length - 1] !== '*';
      if (!isDelConfirm) {
        const nextIdx = mgmt_del_confirms.length + 1;
        return `read=t-האם אתם בטוחים שברצונכם למחוק את אמצעי התשלום.t-לאישור הקישו 1=mgmt_del_confirm_${nextIdx},,1,,,NO,,,,1*,,,,,no`;
      }

      const delReq = await fetch(`${BASE_URL}/CreditCard/${currentCard.id}`, {
        method: 'DELETE',
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (delReq.status === 204 || delReq.ok) {
        return `id_list_message=t-אמצעי התשלום נמחק בהצלחה`;
      } else {
        return `id_list_message=t-שגיאה במחיקת אמצעי התשלום`;
      }
    }
  } 
  
  // ------------------------------------------------------------------
  // נתיב 2: ניהול החידוש האוטומטי
  // ------------------------------------------------------------------
  else if (mgmtMainVal === '2') {
    const isMgmtRenew = mgmt_renews.length > 0 && mgmt_renews[mgmt_renews.length - 1] !== '*';
    const mgmtRenewVal = isMgmtRenew ? mgmt_renews[mgmt_renews.length - 1] : null;

    if (!isMgmtRenew) {
      const nextIdx = mgmt_renews.length + 1;
      return `read=t-לניהול חידוש אוטומטי למנוי הקישו 1.t-לניהול חידוש אוטומטי לרישיון הקישו 2.t-לניהול טעינת פעימות אוטומטית הקישו 3=mgmt_renew_${nextIdx},,1,,,NO,,,,123*,,,,,no`;
    }

    if (mgmtRenewVal === '1') { // מנוי חודשי
      const subSelections = mgmt_renews.filter(v => v === '1').length;
      const subActionCount = mgmt_renew_sub_confirms.length;

      if (subActionCount < subSelections) {
        const statusStr = clientData.autoRenewSubscription ? "מופעל" : "כבוי";
        const actStr = clientData.autoRenewSubscription ? "לביטול" : "להפעלה";
        const nextIdx = subActionCount + 1;
        return `read=t-חידוש מנוי אוטומטי כעת.t-${statusStr}.t-${actStr}.t-הקישו 1.t-לחזרה הקישו כוכבית=mgmt_renew_sub_confirm_${nextIdx},,1,,,NO,,,,1*,,,,,no`;
      } else {
        const lastConfirm = mgmt_renew_sub_confirms[subActionCount - 1];
        if (lastConfirm === '1') {
          const patchPayload = { ...clientData, autoRenewSubscription: !clientData.autoRenewSubscription };
          const patchReq = await fetch(`${BASE_URL}/Client/${clientId}`, {
            method: 'PATCH',
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(patchPayload)
          });

          const nextIdx = mgmt_renews.length + 1;
          const resultText = patchReq.ok
            ? `t-חידוש מנוי אוטומטי ${!clientData.autoRenewSubscription ? "הופעל" : "בוטל"} בהצלחה`
            : `t-שגיאה בעדכון ההגדרות`;

          // חזרה לתפריט
          return `read=${resultText}.t-לניהול חידוש אוטומטי למנוי הקישו 1.t-לניהול חידוש אוטומטי לרישיון הקישו 2.t-לניהול טעינת פעימות אוטומטית הקישו 3=mgmt_renew_${nextIdx},,1,,,NO,,,,123*,,,,,no`;
        } else {
          const nextIdx = mgmt_renews.length + 1;
          return `read=t-לניהול חידוש אוטומטי למנוי הקישו 1.t-לניהול חידוש אוטומטי לרישיון הקישו 2.t-לניהול טעינת פעימות אוטומטית הקישו 3=mgmt_renew_${nextIdx},,1,,,NO,,,,123*,,,,,no`;
        }
      }

    } else if (mgmtRenewVal === '2') { // רישיון שנתי
      const licSelections = mgmt_renews.filter(v => v === '2').length;
      const licActionCount = mgmt_renew_lic_confirms.length;

      if (licActionCount < licSelections) {
        const statusStr = clientData.autoRenewLicence ? "מופעל" : "כבוי";
        const actStr = clientData.autoRenewLicence ? "לביטול" : "להפעלה";
        const nextIdx = licActionCount + 1;
        return `read=t-חידוש רישיון אוטומטי כעת.t-${statusStr}.t-${actStr}.t-הקישו 1.t-לחזרה הקישו כוכבית=mgmt_renew_lic_confirm_${nextIdx},,1,,,NO,,,,1*,,,,,no`;
      } else {
        const lastConfirm = mgmt_renew_lic_confirms[licActionCount - 1];
        if (lastConfirm === '1') {
          const patchPayload = { ...clientData, autoRenewLicence: !clientData.autoRenewLicence };
          const patchReq = await fetch(`${BASE_URL}/Client/${clientId}`, {
            method: 'PATCH',
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(patchPayload)
          });

          const nextIdx = mgmt_renews.length + 1;
          const resultText = patchReq.ok
            ? `t-חידוש רישיון אוטומטי ${!clientData.autoRenewLicence ? "הופעל" : "בוטל"} בהצלחה`
            : `t-שגיאה בעדכון ההגדרות`;

          return `read=${resultText}.t-לניהול חידוש אוטומטי למנוי הקישו 1.t-לניהול חידוש אוטומטי לרישיון הקישו 2.t-לניהול טעינת פעימות אוטומטית הקישו 3=mgmt_renew_${nextIdx},,1,,,NO,,,,123*,,,,,no`;
        } else {
          const nextIdx = mgmt_renews.length + 1;
          return `read=t-לניהול חידוש אוטומטי למנוי הקישו 1.t-לניהול חידוש אוטומטי לרישיון הקישו 2.t-לניהול טעינת פעימות אוטומטית הקישו 3=mgmt_renew_${nextIdx},,1,,,NO,,,,123*,,,,,no`;
        }
      }

    } else if (mgmtRenewVal === '3') { // פעימות - טעינה אוטומטית
      const credSelections = mgmt_renews.filter(v => v === '3').length;
      const credActionCount = mgmt_renew_cred_confirms.length;

      if (credActionCount < credSelections) {
        const statusStr = clientData.autoRenewCredit ? `מופעלת על סך.n-${(clientData.autoRenewCreditAmount || 0) / 100}.t-שקלים` : "כבויה";
        const actStr = clientData.autoRenewCredit ? "לביטול" : "להפעלה";
        const nextIdx = credActionCount + 1;
        return `read=t-טעינת פעימות אוטומטית כעת.t-${statusStr}.t-${actStr}.t-הקישו 1.t-לחזרה הקישו כוכבית=mgmt_renew_cred_confirm_${nextIdx},,1,,,NO,,,,1*,,,,,no`;
      } else {
        const lastConfirm = mgmt_renew_cred_confirms[credActionCount - 1];
        if (lastConfirm === '1') {
          // אם הטעינה כבויה, אנחנו מפעילים אותה וצריכים סכום מהלקוח
          if (!clientData.autoRenewCredit) {
            const currentAmountParam = params[`mgmt_cred_amount_${credSelections}`];

            if (currentAmountParam === undefined) {
              return `read=t-נא להקיש את הסכום בשקלים לטעינה חודשית, ובסיום סולמית=mgmt_cred_amount_${credSelections},,4,,,NO,,,,,,,,,no`;
            } else if (currentAmountParam === '*') {
              const nextIdx = mgmt_renews.length + 1;
              return `read=t-לניהול חידוש אוטומטי למנוי הקישו 1.t-לניהול חידוש אוטומטי לרישיון הקישו 2.t-לניהול טעינת פעימות אוטומטית הקישו 3=mgmt_renew_${nextIdx},,1,,,NO,,,,123*,,,,,no`;
            } else {
              const amountAgorot = parseInt(currentAmountParam, 10) * 100;
              if (isNaN(amountAgorot) || amountAgorot <= 0) {
                // סכום שגוי, מבקשים שוב
                return `read=t-סכום שגוי.t-נא להקיש את הסכום בשקלים לטעינה חודשית, ובסיום סולמית=mgmt_cred_amount_${credSelections},,4,,,NO,,,,,,,,,no`;
              }

              const patchPayload = { ...clientData, autoRenewCredit: true, autoRenewCreditAmount: amountAgorot };
              const patchReq = await fetch(`${BASE_URL}/Client/${clientId}`, {
                method: 'PATCH',
                headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(patchPayload)
              });

              const nextIdx = mgmt_renews.length + 1;
              const resultText = patchReq.ok
                ? `t-טעינת פעימות אוטומטית הופעלה בהצלחה על סך.n-${currentAmountParam}.t-שקלים`
                : `t-שגיאה בעדכון ההגדרות`;

              return `read=${resultText}.t-לניהול חידוש אוטומטי למנוי הקישו 1.t-לניהול חידוש אוטומטי לרישיון הקישו 2.t-לניהול טעינת פעימות אוטומטית הקישו 3=mgmt_renew_${nextIdx},,1,,,NO,,,,123*,,,,,no`;
            }
          } else {
            // אם הטעינה מופעלת, אנחנו מבטלים אותה (אין צורך בסכום)
            const patchPayload = { ...clientData, autoRenewCredit: false, autoRenewCreditAmount: null };
            const patchReq = await fetch(`${BASE_URL}/Client/${clientId}`, {
              method: 'PATCH',
              headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify(patchPayload)
            });

            const nextIdx = mgmt_renews.length + 1;
            const resultText = patchReq.ok
              ? `t-טעינת פעימות אוטומטית בוטלה בהצלחה`
              : `t-שגיאה בעדכון ההגדרות`;

            return `read=${resultText}.t-לניהול חידוש אוטומטי למנוי הקישו 1.t-לניהול חידוש אוטומטי לרישיון הקישו 2.t-לניהול טעינת פעימות אוטומטית הקישו 3=mgmt_renew_${nextIdx},,1,,,NO,,,,123*,,,,,no`;
          }
        } else {
          // ביטול פעולה
          const nextIdx = mgmt_renews.length + 1;
          return `read=t-לניהול חידוש אוטומטי למנוי הקישו 1.t-לניהול חידוש אוטומטי לרישיון הקישו 2.t-לניהול טעינת פעימות אוטומטית הקישו 3=mgmt_renew_${nextIdx},,1,,,NO,,,,123*,,,,,no`;
        }
      }
    }
  }

  return "&";
}
