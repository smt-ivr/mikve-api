import { getValidToken } from './auth.js';
import { getActiveClient } from './clients.js';
import { processIvrFlow } from './payment.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let params = {};

    // חילוץ פרמטרים
    if (request.method === 'GET') {
      for (const [key, value] of url.searchParams.entries()) {
        params[key] = value;
      }
    } else if (request.method === 'POST') {
      try {
        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const formData = await request.formData();
          for (const [key, value] of formData.entries()) {
            params[key] = value;
          }
        } else {
          params = await request.json();
        }
      } catch (e) {
        return respond("id_list_message=t-שגיאה, פורמט בקשה לא תקין");
      }
    }

    if (!params.user || !params.pass || !params.club) {
      return respond("id_list_message=t-שגיאה, חסרים פרטי התחברות למערכת");
    }

    try {
      // 1. טיפול בטוקן
      const token = await getValidToken(params, env);

      // 2. מציאת הלקוח
      const { clientData, yemotResponse } = await getActiveClient(params, token);
      
      // אם יש תגובת מערכת (למשל בקשה להקיש ת"ז או בחירת לקוח מכמה אפשרויות)
      if (yemotResponse) {
        return respond(yemotResponse);
      }

      // 3. ניהול תהליך התשלום
      const finalResponse = await processIvrFlow(clientData, params, token, env);
      return respond(finalResponse);

    } catch (error) {
      return respond(`id_list_message=t-שגיאה במערכת: ${error.message.replace(/[\.\-]/g, ' ')}`);
    }
  }
};

function respond(text) {
  return new Response(text + "&", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
