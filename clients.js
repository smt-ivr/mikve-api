const BASE_URL = "https://prod.xn--8dbba8a7b.com";

function cleanText(text) {
  return text ? text.replace(/[\.\-]/g, ' ').trim() : "";
}

export async function getActiveClient(params, token) {
  const clientsRes = await fetch(`${BASE_URL}/Client`, {
    method: 'GET',
    headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club }
  });

  if (!clientsRes.ok) throw new Error("שגיאה בשליפת נתוני לקוחות");

  const clientsRaw = await clientsRes.json();
  const clientsList = Array.isArray(clientsRaw) ? clientsRaw : (clientsRaw.data || clientsRaw.items || []);
  
  const cleanApiPhoneNum = params.ApiPhone ? parseInt(params.ApiPhone.replace(/\D/g, ''), 10) : null;
  const cleanClientIdNum = params.client_id ? parseInt(params.client_id.replace(/\D/g, ''), 10) : null;

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
    return { yemotResponse: `read=t-לא זיהינו את מספר הטלפון שלך במערכת.t-נא להקיש את מספר תעודת הזהות שלכם, ובסיום סולמית=client_id,,10,,,NO,,,,,,,,,no` };
  }

  let selectedClient = null;

  if (matches.length === 1) {
    selectedClient = matches[0];
  } else {
    if (!params.client_index) {
      let ttsParts = [`t-נמצאו`, `n-${matches.length}`, `t-לקוחות המשויכים למזהה זה`];
      matches.forEach((c, idx) => {
        ttsParts.push(`t-ללקוח`, `t-${cleanText(c.firstName)} ${cleanText(c.lastName)}`, `t-הקישו`, `n-${idx + 1}`);
      });
      return { yemotResponse: `read=${ttsParts.join(".")}=client_index,,${String(matches.length).length},,,NO,,,,` };
    } else {
      const chosenIndex = parseInt(params.client_index) - 1;
      if (chosenIndex >= 0 && chosenIndex < matches.length) {
        selectedClient = matches[chosenIndex];
      } else {
        return { yemotResponse: `id_list_message=t-בחירה שגויה` };
      }
    }
  }

  // שליפת לקוח מלא
  const singleClientRes = await fetch(`${BASE_URL}/Client/${selectedClient.id}`, {
    method: 'GET',
    headers: { "Authorization": `Bearer ${token}`, "clubExternalId": params.club }
  });

  if (!singleClientRes.ok) throw new Error("שגיאה בשליפת פרטי הלקוח המלאים");
  
  const clientData = await singleClientRes.json();
  return { clientData };
}
