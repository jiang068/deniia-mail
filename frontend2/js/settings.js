// ===== 设置页（主题 + 强调色）=====
const { createApp, ref, onMounted } = window.Vue;

import {
    currentUser, isAdmin, isAuthenticated,
    loadConfig, ensureAuth, clearAuth,
    currentMailbox, fetchMailboxes,
    navFolders, refreshIcons, theme, accent, ACCENT_PRESETS, setTheme, setAccent,
} from './mail.js';

const appConfig = {
    setup() {
        async function boot() {
            const ok = await loadConfig();
            if (ok) {
                const authed = await ensureAuth(false);
                if (authed) await fetchMailboxes();
            }
            refreshIcons();
        }

        function doLogout() { clearAuth(); location.href = 'login.html'; }

        onMounted(boot);

        return {
            isAuthenticated, isAdmin, currentUser, currentMailbox, navFolders,
            theme, accent, ACCENT_PRESETS, setTheme, setAccent, doLogout,
        };
    }
};

const app = createApp(appConfig);
app.mount('#app');
window.__app = app;
console.log('[DBG-PAGE] 挂载: settings.js', location.pathname, import.meta.url.includes('?v=') ? '[PJAX重挂载]' : '[全量加载]');