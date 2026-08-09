// ===== 首页（欢迎页）=====
const { createApp, ref, computed, onMounted } = window.Vue;

import {
    baseUrl, defaultDomain, currentUser, currentMailbox,
    configError, configErrorMessage, loadConfig, ensureAuth, refreshIcons,
} from './mail.js';

const appConfig = {
    setup() {
        const loggedIn = ref(false);

        // 是否已登录：用快路径校验（TTL 内直接复用，不发网络请求）
        async function boot() {
            const ok = await loadConfig();
            if (ok) {
                const authed = await ensureAuth(false);
                loggedIn.value = authed;
            }
            refreshIcons();
        }

        onMounted(boot);

        return {
            baseUrl, defaultDomain, currentUser, currentMailbox,
            configError, configErrorMessage, loggedIn,
            recall: boot,
        };
    }
};

const app = createApp(appConfig);
app.mount('#app');
window.__app = app;
console.log('[DBG-PAGE] 挂载: index.js(欢迎页)', location.pathname, import.meta.url.includes('?v=') ? '[PJAX重挂载]' : '[全量加载]');