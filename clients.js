const BASE_URL = "https://prod.xn--8dbba8a7b.com";

function cleanText(text) {
  return text ? text.replace(/[\.\-]/g, ' ').trim() : "";
}

function getAllParams(params, prefix) {
  let arr = [];
  let i = 1;
  while(params[`${prefix}_${i}`] !== undefined) {
    arr.push(params[`${prefix}_${i}`]);
    i++;
  }
  return arr;
}

export async function getActiveClient(params, token) {
  const clientsRes = await fetch(`${BASE_URL}/Client`, {
    method: 'GET',
    headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club }
  });

  if (!clientsRes.ok) throw new Error("שגיאה בשליפת נתוני לקוחות");

  const clientsRaw = await clientsRes.json();
  const clientsList = Array.isArray(clientsRaw) ? clientsRaw : (clientsRaw.data || clientsRaw.items || []);
  
  const client_ids = getAllParams(params, 'client_id');
  const main_menus = getAllParams(params, 'main_menu');
  
  // בדיקה אם הלקוח הקיש כוכבית בתפריט הראשי והוא צריך להקיש כעת ת"ז
  const forceIdCount = main_menus.filter(v => v === '*').length;
  const needIdPrompt = forceIdCount > client_ids.length;

  if (needIdPrompt) {
    return { yemotResponse: `read=t-נא להקיש את מספר תעודת הזהות שלכם, ובסיום סולמית=client_id_${client_ids.length + 1},,10,,,NO,,,,,,,,,no` };
  }

  const activeClientIdRaw = client_ids.length > 0 ? client_ids[client_ids.length - 1] : null;
  const cleanClientIdNum = activeClientIdRaw ? parseInt(activeClientIdRaw.replace(/\D/g, ''), 10) : null;
  const cleanApiPhoneNum = params.ApiPhone ? parseInt(params.ApiPhone.replace(/\D/g, ''), 10) : null;

  let matches = [];

  if (cleanClientIdNum) {
    matches = clientsList.filter(c => {
      const pId = parseInt((c.personalId || '').toString().replace(/\D/g, ''), 10);
      const passId = parseInt((c.password || '').toString().replace(/\D/g, ''), 10);
      return pId === cleanClientIdNum || passId === cleanClientIdNum;
    });
  } else if (cleanApiPhoneNum) {
    matches = clientsList.filter(c => {
      const phone = parseInt((c.phone || '').toString().replace(/\D/g, ''), 10);
      return phone === cleanApiPhoneNum;
    });
  }

  if (matches.length === 0) {
    if (cleanClientIdNum) {
      return { yemotResponse: `id_list_message=t-תעודת הזהות לא נמצאה` };
    }
    return { yemotResponse: `read=t-לא זיהינו את מספר הטלפון שלך במערכת.t-נא להקיש את מספר תעודת הזהות שלכם, ובסיום סולמית=client_id_${client_ids.length + 1},,10,,,NO,,,,,,,,,no` };
  }

  let selectedClient = null;

  if (matches.length === 1) {
    selectedClient = matches[0];
  } else {
    const client_indices = getAllParams(params, 'client_index');
    const client_index = client_indices.length > 0 ? client_indices[client_indices.length - 1] : null;

    if (!client_index) {
      let ttsParts = [`t-נמצאו`, `n-${matches.length}`, `t-לקוחות המשויכים למזהה זה`];
      matches.forEach((c, idx) => {
        ttsParts.push(`t-ללקוח`, `t-${cleanText(c.firstName)} ${cleanText(c.lastName)}`, `t-הקישו`, `n-${idx + 1}`);
      });
      return { yemotResponse: `read=${ttsParts.join(".")}=client_index_${client_indices.length + 1},,${String(matches.length).length},,,NO,,,,,,,,,no` };
    } else {
      const chosenIndex = parseInt(client_index) - 1;
      if (chosenIndex >= 0 && chosenIndex < matches.length) {
        selectedClient = matches[chosenIndex];
      } else {
        return { yemotResponse: `id_list_message=t-בחירה שגויה` };
      }
    }
  }

  const singleClientRes = await fetch(`${BASE_URL}/Client/${selectedClient.id}`, {
    method: 'GET',
    headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club }
  });

  if (!singleClientRes.ok) throw new Error("שגיאה בשליפת פרטי הלקוח המלאים");
  
  const clientData = await singleClientRes.json();
  return { clientData };
}
