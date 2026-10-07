// terminals.js
const BASE_URL = "https://prod.xn--8dbba8a7b.com";

function cleanText(text) {
  return text ? text.replace(/[\.\-\"\'\,\:\;\!\?\(\)\[\]]/g, ' ').replace(/\s+/g, ' ').trim() : "";
}

function getAllParams(params, prefix) {
  let arr = [];
  if (params[prefix] !== undefined) {
    arr.push(params[prefix]);
  }
  let i = 1;
  while(params[`${prefix}_${i}`] !== undefined) {
    arr.push(params[`${prefix}_${i}`]);
    i++;
  }
  return arr;
}

export async function processTerminalFlow(params, token, env) {
  const clubId = params.club;
  const username = params.user;
  const apiPhone = params.ApiPhone || "";

  const terminal_choices = getAllParams(params, 'terminal');
  const action_choices = getAllParams(params, 'action');

  const clubRes = await fetch(`${BASE_URL}/Club/GetCurrent`, {
    method: 'GET',
    headers: { "Authorization": `Bearer ${token}`, "clubExternalId": clubId }
  });
  
  if (!clubRes.ok) return "id_list_message=t-שגיאה לא ניתן למשוך נתוני מערכת";
  const clubData = await clubRes.json();

  const terminalsRes = await fetch(`${BASE_URL}/Terminal`, {
    method: 'GET',
    headers: { "Authorization": `Bearer ${token}`, "clubExternalId": clubId }
  });

  if (!terminalsRes.ok) return "id_list_message=t-שגיאה בשליפת רשימת המסופים";
  
  let terminals = await terminalsRes.json();
  terminals = terminals.map((t, i) => ({ index: i + 1, ...t }));

  if (terminals.length === 0) return "id_list_message=t-לא נמצאו מסופים פעילים במערכת";

  const maxLen = Math.max(...terminals.map(t => String(t.index).length), 1);
  const allowedDigits = Array.from(new Set(terminals.flatMap(t => String(t.index).split('')))).sort().join('');

  if (terminal_choices.length === 0) {
    const cleanClubName = cleanText(clubData.name);
    let tts = `t-מחובר למערכת ${cleanClubName} נא לבחור את המסוף הרצוי`;
    terminals.forEach(t => {
      tts += ` למסוף ${cleanText(t.name)} הקישו ${t.index}`;
    });
    
    return `read=${tts}=terminal_1,,${maxLen},,,NO,,,,${allowedDigits},,,,,no`;
  }

  const currentTerminalChoice = terminal_choices[terminal_choices.length - 1];
  const selectedTerminal = terminals.find(t => t.index == currentTerminalChoice || t.id == currentTerminalChoice);
  
  if (!selectedTerminal) {
    const nextIdx = terminal_choices.length + 1;
    return `read=t-שגיאה מסוף לא חוקי נא לנסות שוב=terminal_${nextIdx},,${maxLen},,,NO,,,,${allowedDigits},,,,,no`;
  }

  if (action_choices.length === 0) {
    let isAlive = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
      const pingReq = await fetch(`${BASE_URL}/api/v1/Terminal/TerminalPing`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "clubExternalId": clubId,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          terminalId: selectedTerminal.id,
          targetId: selectedTerminal.hardwareId,
          actionName: "action",
          data: ""
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      if (pingReq.ok) {
        const pingData = await pingReq.json();
        if (pingData.isAlive) isAlive = true;
      }
    } catch (e) {
      clearTimeout(timeoutId);
    }

    const cleanTermName = cleanText(selectedTerminal.name);
    const statusText = isAlive ? "מחובר לרשת" : "מנותק מהרשת";
    
    const tts = `t-מסוף ${cleanTermName} ${statusText} נא בחר פקודה לשליחה לפתיחת הדלת פעם אחת הקישו 1 לרענון המסוף הקישו 2 להפעלה מחדש הקישו 3 לבדיקת עדכונים הקישו 4`;
    
    const nextIdx = action_choices.length + 1;
    return `read=${tts}=action_${nextIdx},,1,,,NO,,,,1234,,,,,no`;
  }

  const currentActionChoice = action_choices[action_choices.length - 1];
  const actionsMap = {
    "1": "openGate",
    "2": "reload",
    "3": "reboot",
    "4": "checkUpdates"
  };
  const actionName = actionsMap[currentActionChoice];
  
  if (!actionName) {
    const nextIdx = action_choices.length + 1;
    return `read=t-שגיאה פקודה לא חוקית נא לנסות שוב=action_${nextIdx},,1,,,NO,,,,1234,,,,,no`;
  }

  const actionReq = await fetch(`${BASE_URL}/Terminal/TerminalAction`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "clubExternalId": clubId,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      terminalId: selectedTerminal.id,
      targetId: selectedTerminal.hardwareId,
      actionName: actionName,
      data: ""
    })
  });

  const statusLog = actionReq.ok ? 'SUCCESS' : 'FAILED';

  await env.DB.prepare("INSERT INTO terminal_logs (club_id, username, terminal_id, action_name, status, api_phone) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(clubId, username, selectedTerminal.id, actionName, statusLog, apiPhone)
    .run();

  if (actionReq.ok) {
    return `id_list_message=t-הפקודה נשלחה בהצלחה למסוף`;
  } else {
    return `id_list_message=t-שגיאה בשליחת הפקודה`;
  }
}
