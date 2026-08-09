// ===== 管理后台页 =====
const { createApp, ref, onMounted } = window.Vue;

import {
    baseUrl, isAdmin, isAuthenticated,
    loadConfig, ensureAuth, clearAuth,
    currentMailbox, fetchMailboxes,
    navFolders, refreshIcons, authHeaders,
} from './mail.js';

const appConfig = {
    setup() {
        const ready = ref(false);
        const errorMessage = ref('');
        const adminSettings = ref({ allow_registration: 'false', daily_send_limit: '50', default_mailbox_limit: '3' });
        const adminUsers = ref([]);

        async function boot() {
            const ok = await loadConfig();
            if (ok) {
                const authed = await ensureAuth(false);
                if (authed) {
                    await fetchMailboxes();
                    if (isAdmin.value) await loadAdmin();
                }
            }
            ready.value = true;
            refreshIcons();
        }

        async function loadAdmin() {
            try {
                const [settingsRes, usersRes] = await Promise.all([
                    fetch(`${baseUrl.value}/api/admin/settings`, { headers: authHeaders() }),
                    fetch(`${baseUrl.value}/api/admin/users`, { headers: authHeaders() })
                ]);
                const sData = await settingsRes.json();
                adminSettings.value = sData.settings || {};
                const uData = await usersRes.json();
                adminUsers.value = uData.users || [];
            } catch (e) { errorMessage.value = '加载管理面板失败: ' + e.message; }
            refreshIcons();
        }

        async function toggleRegistration() {
            const newVal = adminSettings.value.allow_registration === 'true' ? 'false' : 'true';
            try {
                const res = await fetch(`${baseUrl.value}/api/admin/settings`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({ key: 'allow_registration', value: newVal })
                });
                const data = await res.json();
                if (data.ok) adminSettings.value.allow_registration = newVal;
            } catch (e) { errorMessage.value = '更新失败: ' + e.message; }
        }

        function updateSendLimit() {
            fetch(`${baseUrl.value}/api/admin/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ key: 'daily_send_limit', value: String(adminSettings.value.daily_send_limit) })
            }).then(r => r.json()).then(d => { if (!d.ok) errorMessage.value = '更新失败'; })
                .catch(e => errorMessage.value = '更新失败: ' + e.message);
        }

        function updateDefaultMailboxLimit() {
            fetch(`${baseUrl.value}/api/admin/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ key: 'default_mailbox_limit', value: String(adminSettings.value.default_mailbox_limit) })
            }).then(r => r.json()).then(d => { if (!d.ok) errorMessage.value = '更新失败'; })
                .catch(e => errorMessage.value = '更新失败: ' + e.message);
        }

        function doLogout() { clearAuth(); location.href = 'login.html'; }

        onMounted(boot);

        return {
            ready, isAuthenticated, isAdmin, currentMailbox, navFolders,
            errorMessage, adminSettings, adminUsers,
            toggleRegistration, updateSendLimit, updateDefaultMailboxLimit, doLogout,
        };
    }
};

const app = createApp(appConfig);
app.mount('#app');
window.__app = app;
console.log('[DBG-PAGE] 挂载: admin.js', location.pathname, import.meta.url.includes('?v=') ? '[PJAX重挂载]' : '[全量加载]');