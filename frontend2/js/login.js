// ===== 登录 / 注册页 =====
const { createApp, ref, onMounted } = window.Vue;

import {
    baseUrl, defaultDomain, token, currentUser, isAdmin, isAuthenticated,
    configError, configErrorMessage, loadConfig, ensureAuth,
    mailboxes, fetchMailboxes, fetchQuota, refreshIcons, setSelectedMailbox,
} from './mail.js';

const appConfig = {
    setup() {
        const loading = ref(false);
        const showRegister = ref(false);
        const errorMessage = ref('');
        const loginForm = ref({ username: '', password: '' });
        const registerForm = ref({ username: '', password: '' });
        const isFirstRun = ref(false);
        const checked = ref(false);

        // 判断是否为首次使用（尚无管理员），决定是否展示"首注即管理员"提示
        async function checkSetup() {
            try {
                const res = await fetch(`${baseUrl.value}/api/admin/check`);
                const d = await res.json();
                isFirstRun.value = !d.admin_exists;
            } catch { isFirstRun.value = false; }
        }

        async function boot() {
            const ok = await loadConfig();
            if (ok) {
                // 若已登录，跳到收件箱
                const authed = await ensureAuth(false);
                if (authed) { location.href = 'inbox.html'; return; }
                await checkSetup();
            }
            checked.value = true;
            refreshIcons();
        }

        async function doLogin() {
            loading.value = true; errorMessage.value = '';
            try {
                const res = await fetch(`${baseUrl.value}/api/login`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(loginForm.value)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
                token.value = data.token;
                currentUser.value = loginForm.value.username;
                isAdmin.value = data.role === 'admin';
                isAuthenticated.value = true;
                localStorage.setItem('cf_mail_token', data.token);
                localStorage.setItem('cf_mail_user', currentUser.value);
                await fetchMailboxes();
                await fetchQuota();
                if (mailboxes.value.length > 0 && !localStorage.getItem('cf_mail_selected')) {
                    setSelectedMailbox(mailboxes.value[0].address);
                }
                location.href = 'inbox.html';
            } catch (err) { errorMessage.value = '登录失败: ' + err.message; }
            finally { loading.value = false; refreshIcons(); }
        }

        async function doRegister() {
            loading.value = true; errorMessage.value = '';
            try {
                const res = await fetch(`${baseUrl.value}/api/register`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(registerForm.value)
                });
                const data = await res.json().catch(() => ({}));
                if (data.ok) {
                    showRegister.value = false;
                    loginForm.value.username = registerForm.value.username;
                    registerForm.value = { username: '', password: '' };
                    errorMessage.value = '注册成功，请登录';
                } else throw new Error(data.error || '注册失败');
            } catch (err) { errorMessage.value = '注册失败: ' + err.message; }
            finally { loading.value = false; }
        }

        onMounted(boot);

        return {
            baseUrl, configError, configErrorMessage, checked,
            loading, showRegister, errorMessage, loginForm, registerForm, isFirstRun,
            recall: boot, doLogin, doRegister,
        };
    }
};

const app = createApp(appConfig);
app.mount('#app');
window.__app = app;
console.log('[DBG-PAGE] 挂载: login.js', location.pathname, import.meta.url.includes('?v=') ? '[PJAX重挂载]' : '[全量加载]');