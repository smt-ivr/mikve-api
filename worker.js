// worker.js
import { handleSaasRequest } from './saas-api.js';
import { getValidToken } from './auth.js';
import { getActiveClient } from './clients.js';
import { processIvrFlow } from './payment.js';
import { processManagementFlow } from './management.js';
import { processTerminalFlow } from './terminals.js';
import { dashboardHTML } from './dashboard-html.js';
import { handlePublicApi } from './public-api.js';
import { ensureSchema } from './schema.js';
import apiDocs from './API.md';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/mikve' || path === '/mikve/') {
      return new Response(dashboardHTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // תיעוד API להורדה (Markdown - מתאים להעברה ל-AI)
    if (path === '/mikve/docs/api.md' || path === '/mikve/api/docs') {
      const docs = apiDocs.replaceAll('{{BASE_URL}}', `${url.origin}/mikve/api/v1`);
      const headers = { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*" };
      if (url.searchParams.has('download')) headers["Content-Disposition"] = 'attachment; filename="mikve-api-docs.md"';
      return new Response(docs, { headers });
    }

    if (path.startsWith('/mikve/api')) {
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key"
      };
      
      if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
      
      let response;
      if (path === '/mikve/api/v1' || path.startsWith('/mikve/api/v1/')) {
        await ensureSchema(env);
        response = await handlePublicApi(request, env, path.substring('/mikve/api/v1'.length));
      } else {
        response = await handleSaasRequest(request, env);
      }
      const responseHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) responseHeaders.set(key, value);
      
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    }

    if (path.startsWith('/mikve/yemot')) {
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

      try { await ensureSchema(env); } catch (e) {}

      const userToken = params.token;
      
      if (!userToken) {
         return respond("id_list_message=t-המערכת עודכנה לשיטת חיבור חדשה אנא פנו למנהל המערכת");
      }

      let clubCreds;
      try {
          clubCreds = await env.DB.prepare(`
              SELECT t.target_club_id, t.target_username, t.target_password, u.can_use_payment, u.can_use_terminal 
              FROM saas_tokens t 
              JOIN saas_users u ON t.user_id = u.id 
              WHERE t.token = ?
          `).bind(userToken).first();
      } catch(e) {
          return respond("id_list_message=t-שגיאה במסד הנתונים");
      }

      if (!clubCreds) {
          return respond("id_list_message=t-שגיאה מזהה מערכת לא חוקי");
      }

      if (path === '/mikve/yemot/terminal' && !clubCreds.can_use_terminal) {
          return respond("id_list_message=t-אין לחשבון זה הרשאה למערכת פתיחת דלתות");
      }

      if (path === '/mikve/yemot' && !clubCreds.can_use_payment) {
          return respond("id_list_message=t-אין לחשבון זה הרשאה למערכת סליקת אשראי");
      }

      params.club = clubCreds.target_club_id;
      params.user = clubCreds.target_username;
      params.pass = clubCreds.target_password;

      try {
        const token = await getValidToken(params, env);

        if (path === '/mikve/yemot/terminal') {
          const terminalResponse = await processTerminalFlow(params, token, env);
          return respond(terminalResponse);
        }

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

    return new Response("נתיב לא נמצא. הגישה נדחתה.", { 
      status: 404, 
      headers: { "Content-Type": "text/plain; charset=utf-8" } 
    });
  }
};

function respond(text) {
  return new Response(text + "&", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
