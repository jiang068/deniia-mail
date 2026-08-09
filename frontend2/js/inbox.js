// ===== 收件箱页 =====
const { createApp, ref, computed, onMounted, onUnmounted } = window.Vue;

import {
    baseUrl, defaultDomain, token, isAdmin, isAuthenticated, authChecking,
    loadConfig, ensureAuth, clearAuth,
    mailboxes, selectedMailbox, quota, currentMailbox, fetchMailboxes,
    navFolders, formatDate, refreshIcons,
    remoteContentLevel, protectContent, hasExternalImagesOf, hasAdvancedTrackersOf,
    setSelectedMailbox,
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
        const viewMode = ref('rendered');

        // 缓存
        const emailDetailCache = new Map();
        const emailListCache = new Map();   // key mailbox → {data,timestamp}
        const LIST_CACHE_TTL = 15000;

        // 轮询
        let statusPollTimer = null;

        const hasExternalImages = computed(() => hasExternalImagesOf(selectedEmail.value?.html || ''));
        const hasAdvancedTrackers = computed(() => hasAdvancedTrackersOf(selectedEmail.value?.html || ''));

        const protectedContent = computed(() => {
            remoteContentLevel.value; // 显式依赖，切换时重算
            const raw = selectedEmail.value?.html || selectedEmail.value?.text || '';
            return protectContent(raw);
        });

        const filteredEmails = computed(() => {
            if (!searchQuery.value) return emails.value;
            const q = searchQuery.value.toLowerCase();
            return (emails.value || []).filter(e =>
                (e.subject && e.subject.toLowerCase().includes(q)) ||
                (e.sender && e.sender.toLowerCase().includes(q)) ||
                (e.from_addr && e.from_addr.toLowerCase().includes(q)));
        });

        // ---- 登录态分发 ----
        async function boot() {
            const ok = await loadConfig();
            if (!ok) { refreshIcons(); return; }
            const authed = await ensureAuth(true);
            if (authed) { await fetchMailboxes(); await fetchEmails(); startStatusPolling(); }
            refreshIcons();
        }

        // ---- Auth 动作 ----
        function doLogout() {
            clearAuth(); stopStatusPolling();
            location.href = 'login.html';
        }

        // ---- 邮箱（新建弹窗交给共享模块，创建成功后刷新列表）----
        function openMailboxDialogHandler() {
            return openMailboxDialog({ onCreated: () => fetchEmails(true), refreshIcons });
        }

        async function switchMailbox(address) {
            setSelectedMailbox(address);
            selectedEmail.value = null;
            await fetchEmails();
        }

        async function fetchEmails(force = false) {
            if (!isAuthenticated.value || !currentMailbox.value) return;
            const cacheKey = currentMailbox.value;
            const cached = emailListCache.get(cacheKey);
            if (!force && cached && Date.now() - cached.timestamp < LIST_CACHE_TTL) { emails.value = cached.data; return; }
            loadingEmails.value = true;
            try {
                const res = await fetch(`${baseUrl.value}/api/emails?mailbox=${encodeURIComponent(currentMailbox.value)}`, {
                    headers: { Authorization: `Bearer ${token.value}` }
                });
                const data = await res.json().catch(() => null);
                if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
                const list = (data && data.emails) ? data.emails : [];
                emails.value = list;
                emailListCache.set(cacheKey, { data: list, timestamp: Date.now() });
            } catch (e) {
                console.error('fetch emails error:', e);
                errorMessage.value = '获取邮件失败: ' + e.message;
                emails.value = [];
            } finally { loadingEmails.value = false; refreshIcons(); }
        }

        function loadEmails() { fetchEmails(); }

        async function selectEmail(mail) {
            remoteContentLevel.value = 0;
            const cacheKey = `email-${mail.id}`;
            const cached = emailDetailCache.get(cacheKey);
            if (cached) {
                selectedEmail.value = { ...mail, ...cached };
                viewMode.value = 'rendered';
                refreshIcons(); return;
            }
            selectedEmail.value = { ...mail };
            viewMode.value = 'rendered';
            loadingDetail.value = true;
            try {
                const res = await fetch(`${baseUrl.value}/api/email/${mail.id}`, { headers: { Authorization: `Bearer ${token.value}` } });
                if (res.ok) {
                    const data = await res.json();
                    const obj = data.email || {};
                    emailDetailCache.set(cacheKey, obj);
                    selectedEmail.value = { ...mail, ...obj };
                }
            } catch (e) { console.error('load detail error:', e); }
            finally { loadingDetail.value = false; refreshIcons(); }
        }

        async function deleteEmail(id) {
            if (!confirm('确定要删除这封邮件吗？')) return;
            try {
                const res = await fetch(`${baseUrl.value}/api/email/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token.value}` } });
                if (!res.ok) throw new Error('删除失败');
                emailDetailCache.delete(`email-${id}`);
                emailListCache.delete(currentMailbox.value);
                selectedEmail.value = null;
                fetchEmails();
            } catch (err) { errorMessage.value = '删除失败: ' + err.message; }
        }

        function setLevel(l) { remoteContentLevel.value = l; refreshIcons(); }

        // ---- 状态轮询 ----
        async function pollDeliveryStatus() {
            if (!isAuthenticated.value || !token.value) return;
            const sentList = (emails.value || []).filter(e => e.delivery_status && e.delivery_status !== 'delivered');
            if (sentList.length === 0) return;
            try {
                const res = await fetch(`${baseUrl.value}/api/emails/check-status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
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
        function startStatusPolling() { stopStatusPolling(); statusPollTimer = setInterval(pollDeliveryStatus, 15000); }
        function stopStatusPolling() { if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; } }

        // 投递状态下拉映射
        const statusMap = {
            'sending': ['发送中', 'text-warn bg-warn-soft'],
            'delivered': ['已送达', 'text-green bg-green-soft'],
            'opened': ['已读', 'text-blue bg-blue-soft'],
            'bounced': ['已退回', 'text-danger bg-danger-soft'],
            'complained': ['被举报', 'text-warn bg-warn-soft'],
            'sent': ['已发送', 'text-sub bg-surface2'],
        };
        function statusCls(s, detail = false) {
            const m = statusMap[s] || [s || '', 'text-sub bg-surface2'];
            return { t: m[0], c: m[1] };
        }

        onMounted(boot);
        onUnmounted(stopStatusPolling);

        return {
            // shared
            baseUrl, defaultDomain, isAdmin, isAuthenticated, authChecking,
            mailboxes, selectedMailbox, quota, currentMailbox,
            navFolders, token,
            // local
            loadingEmails, loadingDetail, errorMessage,
            emails, searchQuery, selectedEmail, viewMode,
            doLogout,
            openMailboxDialog: openMailboxDialogHandler,
            switchMailbox, selectEmail, deleteEmail, fetchEmails, loadEmails,
            filteredEmails, formatDate, protectedContent,
            hasExternalImages, hasAdvancedTrackers, remoteContentLevel, setLevel, statusCls,
        };
    }
};

const app = createApp(appConfig);
app.mount('#app');
window.__app = app;
console.log('[DBG-PAGE] 挂载: inbox.js', location.pathname, import.meta.url.includes('?v=') ? '[PJAX重挂载]' : '[全量加载]');