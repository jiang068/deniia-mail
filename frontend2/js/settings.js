// ===== 设置页（主题 + 强调色）=====
const { createApp, ref, onMounted } = window.Vue;

import {
    currentUser, isAdmin, isAuthenticated,
    loadConfig, ensureAuth, clearAuth,
    currentMailbox, fetchMailboxes,
    navFolders, refreshIcons, theme, accent, ACCENT_PRESETS, setTheme, setAccent,
} from './mail.js';
import { isMobile, sidebarOpen, toggleDrawer, closeDrawer, mobileSidebarCls } from './mobile-shell.js';

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
            isMobile, sidebarOpen, toggleDrawer, closeDrawer, mobileSidebarCls,
        };
    }
};

// 双相 API：导入仅定义，由 pjax 驱动 boot+mount。本页数据在 mount 后的 onMounted 加载。
async function boot() {}

function mount() {
    const app = createApp(appConfig);
    app.mount('#app');
    window.__app = app;
    console.log('[DBG-PAGE] 挂载: settings.js', location.pathname, import.meta.url.includes('?v=') ? '[PJAX重挂载]' : '[全量加载]');
}

export { boot, mount };

// 独立整页加载时自行挂载（无 ?v= → 非 PJAX 导入）
if (!import.meta.url.includes('v=')) boot().then(mount);