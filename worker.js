// worker.js
import { getValidToken } from './auth.js';
import { getActiveClient } from './clients.js';
import { processIvrFlow } from './payment.js';
import { processManagementFlow } from './management.js';
import { processTerminalFlow } from './terminals.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let params = {};

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
        return respond("id_list_message=t-שגיאה פורמט בקשה לא תקין");
      }
    }

    if (!params.user || !params.pass || !params.club) {
      return respond("id_list_message=t-שגיאה חסרים פרטי התחברות למערכת");
    }

    try {
      const token = await getValidToken(params, env);

      // ניתוב לשלוחת המסופים
      if (url.pathname.includes('/terminal')) {
        const terminalResponse = await processTerminalFlow(params, token, env);
        return respond(terminalResponse);
      }

      // הניתוב הרגיל לתשלומים וניהול לקוחות
      const { clientData, yemotResponse } = await getActiveClient(params, token);
      
      if (yemotResponse) {
        return respond(yemotResponse);
      }

      let main_menus = [];
      let i = 1;
      while(params[`main_menu_${i}`] !== undefined) {
        main_menus.push(params[`main_menu_${i}`]);
        i++;
      }
      
      let validMainMenus = main_menus.filter(v => ['1','2','3','4'].includes(v));
      let selectedMenu = validMainMenus.length > 0 ? validMainMenus[validMainMenus.length - 1] : null;

      let finalResponse = "";
      
      if (selectedMenu === '4') {
        finalResponse = await processManagementFlow(clientData, params, token, env);
      } else {
        finalResponse = await processIvrFlow(clientData, params, token, env);
      }

      return respond(finalResponse);

    } catch (error) {
      return respond(`id_list_message=t-שגיאה במערכת ${error.message.replace(/[\.\-]/g, ' ')}`);
    }
  }
};

function respond(text) {
  return new Response(text + "&", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
