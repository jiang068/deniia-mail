// ===== 已发送页 =====
const { createApp, ref, computed, onMounted, onUnmounted } = window.Vue;

import {
    baseUrl, defaultDomain, token, isAdmin, isAuthenticated, authChecking,
    loadConfig, ensureAuth, clearAuth,
    mailboxes, selectedMailbox, quota, currentMailbox, fetchMailboxes, fetchQuota,
    navFolders, formatDate, refreshIcons,
    protectContent, setSelectedMailbox,
} from './mail.js';
import { openMailboxDialog } from './mailbox-dialog.js';

const appConfig = {
    setup() {
        const loadingEmails = ref(false);
        const loadingDetail = ref(false);
        const errorMessage = ref('');
        const emails = ref([]);
        const searchQuery = ref('');
        const selectedEmail = ref(null);
        const emailDetailCache = new Map();
        const emailListCache = new Map();
        const LIST_CACHE_TTL = 10000;

        let statusPollTimer = null;

        const filteredEmails = computed(() => {
            if (!searchQuery.value) return emails.value;
            const q = searchQuery.value.toLowerCase();
            return (emails.value || []).filter(e =>
                (e.subject && e.subject.toLowerCase().includes(q)) ||
                (e.to_addrs && e.to_addrs.toLowerCase().includes(q)));
        });

        // 已发送正文：后端返回 text_content 或 html，直接用 protectContent 渲染（同样更安全）
        const sentContent = computed(() => {
            const raw = selectedEmail.value?.html || selectedEmail.value?.text || '';
            return protectContent(raw);
        });

        async function boot() {
            const ok = await loadConfig();
            if (ok) {
                const authed = await ensureAuth(true);
                if (authed) { await fetchMailboxes(); await fetchEmails(); startPolling(); }
            }
            refreshIcons();
        }

        function doLogout() { clearAuth(); stopPolling(); location.href = 'login.html'; }

        async function fetchEmails(force = false) {
            if (!isAuthenticated.value || !currentMailbox.value) return;
            const cacheKey = currentMailbox.value;
            const cached = emailListCache.get(cacheKey);
            if (!force && cached && Date.now() - cached.timestamp < LIST_CACHE_TTL) { emails.value = cached.data; return; }
            loadingEmails.value = true;
            try {
                const res = await fetch(`${baseUrl.value}/api/sent?from=${encodeURIComponent(currentMailbox.value)}`, {
                    headers: { Authorization: `Bearer ${token.value}` }
                });
                const data = await res.json().catch(() => null);
                if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
                const list = (data && data.sent) ? data.sent : [];
                emails.value = list;
                emailListCache.set(cacheKey, { data: list, timestamp: Date.now() });
            } catch (e) { console.error('fetch sent error:', e); emails.value = []; }
            finally { loadingEmails.value = false; refreshIcons(); }
        }

        async function switchMailbox(address) {
            setSelectedMailbox(address);
            selectedEmail.value = null;
            await fetchEmails();
        }

        async function selectEmail(mail) {
            const cacheKey = `sent-${mail.id}`;
            const cached = emailDetailCache.get(cacheKey);
            if (cached) { selectedEmail.value = { ...mail, ...cached }; refreshIcons(); return; }
            selectedEmail.value = { ...mail };
            loadingDetail.value = true;
            try {
                const res = await fetch(`${baseUrl.value}/api/sent/${mail.id}`, { headers: { Authorization: `Bearer ${token.value}` } });
                if (res.ok) {
                    const data = await res.json();
                    const obj = data.sent || {};
                    emailDetailCache.set(cacheKey, obj);
                    selectedEmail.value = { ...mail, ...obj };
                }
            } catch (e) { console.error('load sent detail error:', e); }
            finally { loadingDetail.value = false; refreshIcons(); }
        }

        // 邮箱对话框（交给共享模块，创建成功后刷新列表）
        function openMailboxDialogHandler() {
            return openMailboxDialog({ onCreated: () => fetchEmails(true), refreshIcons });
        }

        // 状态轮询
        async function pollStatus() {
            if (!isAuthenticated.value || !token.value) return;
            const sentList = (emails.value || []).filter(e => e.delivery_status && e.delivery_status !== 'delivered');
            if (sentList.length === 0) return;
            try {
                const res = await fetch(`${baseUrl.value}/api/emails/check-status`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
                    body: JSON.stringify({ ids: sentList.map(e => e.id) })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.results) {
                        const up = {};
                        for (const r of data.results) up[r.id] = r.delivery_status;
                        emails.value = emails.value.map(e => ({ ...e, delivery_status: up[e.id] || e.delivery_status }));
                    }
                }
            } catch (e) { /* silent */ }
        }
        function startPolling() { stopPolling(); statusPollTimer = setInterval(pollStatus, 15000); }
        function stopPolling() { if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; } }

        const statusMap = {
            'sending': ['发送中', 'text-warn bg-warn-soft'],
            'delivered': ['已送达', 'text-green bg-green-soft'],
            'opened': ['已读', 'text-blue bg-blue-soft'],
            'bounced': ['已退回', 'text-danger bg-danger-soft'],
            'complained': ['被举报', 'text-warn bg-warn-soft'],
            'sent': ['已发送', 'text-sub bg-surface2'],
        };
        function statusCls(s) { const m = statusMap[s] || [s || '', 'text-sub bg-surface2']; return { t: m[0], c: m[1] }; }

        onMounted(boot);
        onUnmounted(stopPolling);

        return {
            authChecking, isAuthenticated, isAdmin, defaultDomain, mailboxes, selectedMailbox, quota, currentMailbox, navFolders,
            loadingEmails, loadingDetail, errorMessage,
            emails, searchQuery, selectedEmail, filteredEmails, sentContent,
            doLogout, openMailboxDialog: openMailboxDialogHandler, switchMailbox, selectEmail, fetchEmails,
            formatDate, statusCls,
        };
    }
};

const app = createApp(appConfig);
app.mount('#app');
window.__app = app;
console.log('[DBG-PAGE] 挂载: sent.js', location.pathname, import.meta.url.includes('?v=') ? '[PJAX重挂载]' : '[全量加载]');