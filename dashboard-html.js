// dashboard-html.js
export const dashboardHTML = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>מערכת ניהול - SMTI</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        :root { --primary-color: #2c3e50; --secondary-color: #3498db; --accent-color: #e74c3c; --bg-color: #f4f7f6; --text-color: #333; --sidebar-width: 250px; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background-color: var(--bg-color); color: var(--text-color); display: flex; min-height: 100vh; }
        
        #login-screen { display: flex; justify-content: center; align-items: center; width: 100%; height: 100vh; background: linear-gradient(135deg, var(--primary-color), var(--secondary-color)); }
        .login-box { background: #fff; padding: 40px; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 100%; max-width: 400px; text-align: center; }
        .login-box h2 { margin-bottom: 20px; color: var(--primary-color); }
        .form-control { margin-bottom: 15px; text-align: right; }
        .form-control label { display: block; margin-bottom: 5px; font-weight: bold; }
        .form-control input { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px; font-size: 16px; }
        .btn { width: 100%; padding: 10px; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; transition: 0.3s; }
        .btn-primary { background-color: var(--secondary-color); color: white; }
        .btn-primary:hover { background-color: #2980b9; }
        .btn-danger { background-color: var(--accent-color); color: white; width: auto; padding: 5px 10px; font-size: 14px;}
        .btn-danger:hover { background-color: #c0392b; }
        .btn-sm { padding: 4px 8px; font-size: 12px; }

        #app-layout { display: none; width: 100%; }
        .sidebar { width: var(--sidebar-width); background-color: var(--primary-color); color: white; display: flex; flex-direction: column; position: fixed; height: 100%; right: 0; top: 0; }
        .sidebar-header { padding: 20px; font-size: 20px; font-weight: bold; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .sidebar-menu { list-style: none; padding: 10px 0; flex-grow: 1; }
        .sidebar-menu li { padding: 15px 20px; cursor: pointer; transition: 0.2s; border-right: 4px solid transparent; }
        .sidebar-menu li:hover, .sidebar-menu li.active { background-color: rgba(255,255,255,0.05); border-right-color: var(--secondary-color); }
        .sidebar-menu li i { margin-left: 10px; width: 20px; text-align: center; }
        .sidebar-footer { padding: 20px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1); cursor: pointer; }
        .sidebar-footer:hover { background-color: rgba(255,255,255,0.05); }

        .main-content { margin-right: var(--sidebar-width); padding: 30px; width: calc(100% - var(--sidebar-width)); overflow-x: hidden; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .header h1 { font-size: 24px; color: var(--primary-color); }
        
        .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-bottom: 20px; overflow-x: auto;}
        .card h3 { margin-bottom: 15px; color: var(--primary-color); border-bottom: 2px solid var(--bg-color); padding-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        table th, table td { padding: 12px; text-align: right; border-bottom: 1px solid #eee; }
        table th { background-color: #f9f9f9; font-weight: bold; color: var(--primary-color); }
        .token-string { font-family: monospace; background: #eee; padding: 4px 8px; border-radius: 4px; user-select: all; color: #d35400; font-size: 14px;}
        .form-row { display: flex; gap: 15px; margin-bottom: 15px; align-items: flex-end; flex-wrap: wrap; }
        .form-row .form-control { flex: 1; min-width: 150px; margin-bottom: 0; }
        .hidden { display: none !important; }
        .admin-only, .history-only { display: none; }
        .status-success { color: green; font-weight: bold; }
        .status-failed { color: red; font-weight: bold; }
        .checkbox-group { display: flex; align-items: center; gap: 5px; }
        .checkbox-group input { width: auto; }
    </style>
</head>
<body>

    <div id="login-screen">
        <div class="login-box">
            <h2>מערכת ניהול מנויים</h2>
            <div class="form-control">
                <label>דואר אלקטרוני</label>
                <input type="email" id="login-email" placeholder="הזן כתובת דוא״ל">
            </div>
            <div class="form-control">
                <label>סיסמה</label>
                <input type="password" id="login-password" placeholder="הזן סיסמה">
            </div>
            <button class="btn btn-primary" onclick="handleLogin()">כניסה למערכת</button>
            <p id="login-error" style="color: red; margin-top: 15px; display: none;"></p>
        </div>
    </div>

    <div id="app-layout">
        <div class="sidebar">
            <div class="sidebar-header">SMTI <br><small style="font-size: 12px; font-weight: normal;">מערכות טלפוניות</small></div>
            <ul class="sidebar-menu">
                <li class="active" onclick="switchTab('tokens-view', this)"><i class="fas fa-key"></i> ניהול טוקנים</li>
                <li class="history-only" onclick="switchTab('history-view', this)"><i class="fas fa-history"></i> היסטוריית מסופים</li>
                <li class="admin-only" onclick="switchTab('users-view', this)"><i class="fas fa-users"></i> ניהול לקוחות</li>
                <li class="admin-only" onclick="switchTab('admin-tokens-view', this)"><i class="fas fa-cogs"></i> כל הטוקנים (מנהל)</li>
            </ul>
            <div class="sidebar-footer" onclick="logout()"><i class="fas fa-sign-out-alt"></i> התנתק</div>
        </div>

        <div class="main-content">
            <div class="header">
                <h1 id="page-title">ניהול טוקנים</h1>
                <div>שלום, <span id="user-greeting"></span></div>
            </div>

            <div id="tokens-view" class="view-section">
                <div class="card">
                    <h3>יצירת טוקן חיבור חדש</h3>
                    <div class="form-row">
                        <div class="form-control"><label>שם מזהה</label><input type="text" id="tk-label"></div>
                        <div class="form-control"><label>Club ID</label><input type="text" id="tk-club"></div>
                        <div class="form-control"><label>שם משתמש API</label><input type="text" id="tk-user"></div>
                        <div class="form-control"><label>סיסמת API</label><input type="password" id="tk-pass"></div>
                        <button class="btn btn-primary" style="width: auto; padding: 10px 20px;" onclick="createToken()">צור טוקן</button>
                    </div>
                </div>
                <div class="card">
                    <h3>הטוקנים הפעילים שלי</h3>
                    <table>
                        <thead><tr><th>שם מזהה</th><th>Club ID</th><th>טוקן לימות המשיח</th><th>תאריך יצירה</th><th>פעולות</th></tr></thead>
                        <tbody id="tokens-table-body"></tbody>
                    </table>
                </div>
            </div>

            <div id="history-view" class="view-section hidden">
                <div class="card">
                    <h3>יומן פעולות מסופים</h3>
                    <button class="btn btn-primary btn-sm" style="margin-bottom: 15px;" onclick="loadHistory()"><i class="fas fa-sync"></i> רענן נתונים</button>
                    <table>
                        <thead><tr><th>תאריך ושעה</th><th>מערכת</th><th>מסוף</th><th>פעולה</th><th>טלפון</th><th>סטטוס</th></tr></thead>
                        <tbody id="history-table-body"></tbody>
                    </table>
                </div>
            </div>

            <div id="users-view" class="view-section hidden">
                <div class="card">
                    <h3>הוספת לקוח חדש</h3>
                    <div class="form-row">
                        <div class="form-control"><label>דואר אלקטרוני</label><input type="email" id="new-user-email"></div>
                        <div class="form-control"><label>סיסמה</label><input type="text" id="new-user-pass"></div>
                        <div class="form-control"><label>מכסת טוקנים</label><input type="number" id="new-user-max" value="1" min="1"></div>
                    </div>
                    <div class="form-row" style="margin-bottom: 20px;">
                        <div class="checkbox-group"><input type="checkbox" id="new-user-history"> <label>היסטוריה</label></div>
                        <div class="checkbox-group"><input type="checkbox" id="new-user-payment"> <label>סליקה</label></div>
                        <div class="checkbox-group"><input type="checkbox" id="new-user-terminal"> <label>מסופים</label></div>
                        <button class="btn btn-primary" style="width: auto; padding: 8px 20px; margin-right: auto;" onclick="createUser()">פתח לקוח</button>
                    </div>
                </div>
                <div class="card">
                    <h3>רשימת לקוחות המערכת</h3>
                    <table>
                        <thead><tr><th>ID</th><th>דואר אלקטרוני</th><th>טוקנים מותרים</th><th>היסטוריה</th><th>סליקה</th><th>מסופים</th><th>פעולות מנהל</th></tr></thead>
                        <tbody id="users-table-body"></tbody>
                    </table>
                </div>
            </div>

            <div id="admin-tokens-view" class="view-section hidden">
                <div class="card">
                    <h3>ניהול טוקנים מלא (מנהל)</h3>
                    <table>
                        <thead><tr><th>בעלים</th><th>מזהה</th><th>Club ID</th><th>שם משתמש</th><th>סיסמה</th><th>טוקן</th><th>פעולות</th></tr></thead>
                        <tbody id="admin-tokens-table-body"></tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <script>
        const API_BASE = "https://smti.uk/mikve/api";
        let currentUser = null;
        let authToken = localStorage.getItem('saas_auth_token');

        window.onload = async () => {
            if (authToken) {
                await fetchUserData();
            }
        };

        const apiRequest = async (path, options = {}) => {
            options.headers = { ...options.headers, 'Content-Type': 'application/json', 'Authorization': \`Basic \${authToken}\` };
            const res = await fetch(\`\${API_BASE}\${path}\`, options);
            return res.json();
        };

        async function handleLogin() {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const errorEl = document.getElementById('login-error');
            
            authToken = btoa(email + ':' + password);
            localStorage.setItem('saas_auth_token', authToken);
            
            const success = await fetchUserData();
            if (!success) {
                errorEl.innerText = "פרטי התחברות שגויים.";
                errorEl.style.display = 'block';
                logout();
            }
        }

        async function fetchUserData() {
            try {
                const data = await apiRequest('/me');
                if (data.success) {
                    currentUser = data.user;
                    setupDashboard();
                    return true;
                }
            } catch (e) {}
            return false;
        }

        function setupDashboard() {
            document.getElementById('user-greeting').innerText = currentUser.email;
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-layout').style.display = 'flex';
            
            if(currentUser.is_admin === 1) {
                document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
            }
            if(currentUser.can_view_history === 1 || currentUser.is_admin === 1) {
                document.querySelectorAll('.history-only').forEach(el => el.style.display = 'block');
            }
            loadTokens();
        }

        function logout() {
            currentUser = null;
            authToken = null;
            localStorage.removeItem('saas_auth_token');
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('app-layout').style.display = 'none';
            document.getElementById('login-password').value = '';
            document.querySelectorAll('.admin-only, .history-only').forEach(el => el.style.display = 'none');
            switchTab('tokens-view', document.querySelector('.sidebar-menu li:first-child'));
        }

        function switchTab(tabId, element) {
            document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
            document.getElementById(tabId).classList.remove('hidden');
            document.querySelectorAll('.sidebar-menu li').forEach(el => el.classList.remove('active'));
            element.classList.add('active');

            if(tabId === 'tokens-view') { document.getElementById('page-title').innerText = 'ניהול טוקנים'; loadTokens(); }
            else if(tabId === 'history-view') { document.getElementById('page-title').innerText = 'היסטוריית מסופים'; loadHistory(); }
            else if(tabId === 'users-view') { document.getElementById('page-title').innerText = 'ניהול לקוחות'; loadUsers(); }
            else if(tabId === 'admin-tokens-view') { document.getElementById('page-title').innerText = 'כל הטוקנים במערכת'; loadAdminTokens(); }
        }

        async function loadTokens() {
            const data = await apiRequest('/tokens');
            const tbody = document.getElementById('tokens-table-body');
            tbody.innerHTML = '';
            if (data.tokens && data.tokens.length > 0) {
                data.tokens.forEach(t => {
                    const date = new Date(t.created_at).toLocaleDateString('he-IL');
                    tbody.innerHTML += \`<tr><td>\${t.label}</td><td>\${t.target_club_id}</td><td><span class="token-string">\${t.token}</span></td><td>\${date}</td><td><button class="btn btn-danger btn-sm" onclick="deleteToken(\${t.id})"><i class="fas fa-trash"></i> מחיקה</button></td></tr>\`;
                });
            } else tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">אין טוקנים פעילים במערכת.</td></tr>';
        }

        async function createToken() {
            const label = document.getElementById('tk-label').value;
            const club_id = document.getElementById('tk-club').value;
            const username = document.getElementById('tk-user').value;
            const password = document.getElementById('tk-pass').value;

            if(!label || !club_id || !username || !password) { alert("נא למלא את כל השדות."); return; }

            const data = await apiRequest('/tokens', { method: 'POST', body: JSON.stringify({ label, club_id, username, password }) });
            if (data.success) {
                document.getElementById('tk-label').value = ''; document.getElementById('tk-club').value = '';
                document.getElementById('tk-user').value = ''; document.getElementById('tk-pass').value = '';
                loadTokens();
            } else alert(data.message);
        }

        async function deleteToken(id) {
            if (!confirm("פעולה זו תנתק את המערכת הטלפונית באופן מיידי. להמשיך?")) return;
            const data = await apiRequest(\`/tokens/\${id}\`, { method: 'DELETE' });
            if(data.success) loadTokens(); else alert(data.message);
        }

        async function loadHistory() {
            const data = await apiRequest('/logs');
            const tbody = document.getElementById('history-table-body');
            tbody.innerHTML = '';
            if (data.logs && data.logs.length > 0) {
                data.logs.forEach(l => {
                    const dt = new Date(l.timestamp).toLocaleString('he-IL');
                    const statusClass = l.status === 'SUCCESS' ? 'status-success' : 'status-failed';
                    const statusText = l.status === 'SUCCESS' ? 'הצלחה' : 'נכשל';
                    tbody.innerHTML += \`<tr><td>\${dt}</td><td>\${l.label}</td><td>\${l.terminal_id}</td><td>\${l.action_name}</td><td>\${l.api_phone || '-'}</td><td class="\${statusClass}">\${statusText}</td></tr>\`;
                });
            } else tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">לא נמצאו רשומות היסטוריה.</td></tr>';
        }

        async function loadUsers() {
            const data = await apiRequest('/users');
            const tbody = document.getElementById('users-table-body');
            tbody.innerHTML = '';
            if (data.users && data.users.length > 0) {
                data.users.forEach(u => {
                    tbody.innerHTML += \`
                        <tr>
                            <td>\${u.id}</td>
                            <td>\${u.email}</td>
                            <td><input type="number" id="max_\${u.id}" value="\${u.max_tokens}" style="width: 60px; padding: 4px;"></td>
                            <td><input type="checkbox" id="hist_\${u.id}" \${u.can_view_history ? 'checked' : ''}></td>
                            <td><input type="checkbox" id="pay_\${u.id}" \${u.can_use_payment ? 'checked' : ''}></td>
                            <td><input type="checkbox" id="term_\${u.id}" \${u.can_use_terminal ? 'checked' : ''}></td>
                            <td><button class="btn btn-primary btn-sm" onclick="updateUser(\${u.id})"><i class="fas fa-save"></i> שמור</button></td>
                        </tr>\`;
                });
            } else tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">אין נתונים להצגה</td></tr>';
        }

        async function updateUser(id) {
            const max_tokens = document.getElementById(\`max_\${id}\`).value;
            const can_view_history = document.getElementById(\`hist_\${id}\`).checked;
            const can_use_payment = document.getElementById(\`pay_\${id}\`).checked;
            const can_use_terminal = document.getElementById(\`term_\${id}\`).checked;
            const data = await apiRequest(\`/users/\${id}\`, { method: 'PATCH', body: JSON.stringify({ max_tokens, can_view_history, can_use_payment, can_use_terminal }) });
            if (data.success) { alert("נשמר בהצלחה!"); loadUsers(); } else alert("שגיאה בשמירה");
        }

        async function createUser() {
            const email = document.getElementById('new-user-email').value;
            const password = document.getElementById('new-user-pass').value;
            const max_tokens = document.getElementById('new-user-max').value;
            const can_view_history = document.getElementById('new-user-history').checked;
            const can_use_payment = document.getElementById('new-user-payment').checked;
            const can_use_terminal = document.getElementById('new-user-terminal').checked;

            if(!email || !password) { alert("חובה להזין מייל וסיסמה."); return; }
            const data = await apiRequest('/users', { method: 'POST', body: JSON.stringify({ email, password, max_tokens, can_view_history, can_use_payment, can_use_terminal }) });
            if (data.success) {
                alert("הלקוח נוצר בהצלחה.");
                document.getElementById('new-user-email').value = '';
                document.getElementById('new-user-pass').value = '';
                loadUsers();
            } else alert(data.message);
        }

        async function loadAdminTokens() {
            const data = await apiRequest('/admin/tokens');
            const tbody = document.getElementById('admin-tokens-table-body');
            tbody.innerHTML = '';
            if (data.tokens && data.tokens.length > 0) {
                data.tokens.forEach(t => {
                    tbody.innerHTML += \`<tr>
                        <td>\${t.owner_email}</td>
                        <td>\${t.label}</td>
                        <td>\${t.target_club_id}</td>
                        <td>\${t.target_username}</td>
                        <td>\${t.target_password}</td>
                        <td><span class="token-string" style="font-size:11px;">\${t.token}</span></td>
                        <td><button class="btn btn-primary btn-sm" onclick="transferToken(\${t.id})">העבר בעלות</button></td>
                    </tr>\`;
                });
            } else tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">אין טוקנים פעילים במערכת.</td></tr>';
        }

        async function transferToken(id) {
            const newUserId = prompt("הכנס את מזהה הלקוח (ID) אליו תרצה להעביר את הטוקן:");
            if (!newUserId) return;
            const data = await apiRequest(\`/admin/tokens/\${id}/transfer\`, { method: 'PATCH', body: JSON.stringify({ new_user_id: parseInt(newUserId) }) });
            if (data.success) { alert("הועבר בהצלחה!"); loadAdminTokens(); } else alert("שגיאה בהעברה");
        }
    </script>
</body>
</html>`;
