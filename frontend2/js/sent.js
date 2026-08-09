// ===== 已发送页（双相：boot 预载数据 → mount 挂载）=====
// 与 inbox.js 相同的两相模式：boot 仅准备数据，mount 一次性挂载。
// 响应式状态提到模块作用域，供同一次 import 求值里的 boot/mount 共享。
const { createApp, ref, computed, onMounted, onUnmounted } = window.Vue;

import {
    baseUrl, defaultDomain, token, isAdmin, isAuthenticated, authChecking,
    loadConfig, ensureAuth, clearAuth,
    mailboxes, selectedMailbox, quota, currentMailbox, fetchMailboxes, fetchQuota,
    navFolders, formatDate, refreshIcons,
    protectContent, setSelectedMailbox,
} from './mail.js';
import { openMailboxDialog } from './mailbox-dialog.js';
import { isMobile, sidebarOpen, toggleDrawer, closeDrawer, mobileSidebarCls } from './mobile-shell.js';

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

// 移动端（<md）：列表/详情单屏下钻；桌面恒为固定宽列表 + 弹性详情。
const listColumnCls = computed(() => {
    if (!isMobile.value) return 'w-80 bg-surface border-r border-line flex flex-col flex-shrink-0';
    return selectedEmail.value
        ? 'hidden'
        : 'flex-1 bg-surface border-r border-line flex flex-col min-w-0';
});
const detailCls = computed(() => {
    if (!isMobile.value) return 'flex-1 bg-surface flex flex-col overflow-hidden';
    return selectedEmail.value
        ? 'flex-1 bg-surface flex flex-col overflow-hidden'
        : 'hidden';
});
function backToList() { selectedEmail.value = null; window.scrollTo(0, 0); }

// 已发送正文：后端返回 text_content 或 html，直接用 protectContent 渲染（同样更安全）
const sentContent = computed(() => {
    const raw = selectedEmail.value?.html || selectedEmail.value?.text || '';
    return protectContent(raw);
});

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

// ---------- 双相 API ----------
async function boot() {
    const ok = await loadConfig();
    if (ok) {
        const authed = await ensureAuth(true);
        if (authed) { await fetchMailboxes(); await fetchQuota(); await fetchEmails(); }
    }
}

function mount() {
    const app = createApp({
        setup() {
            onUnmounted(stopPolling);
            return {
                // shared
                authChecking, isAuthenticated, isAdmin, defaultDomain, mailboxes, selectedMailbox, quota, currentMailbox, navFolders,
                // 模块作用域 refs
                loadingEmails, loadingDetail, errorMessage,
                emails, searchQuery, selectedEmail, filteredEmails, sentContent,
                isMobile, sidebarOpen, toggleDrawer, closeDrawer, mobileSidebarCls,
                listColumnCls, detailCls, backToList,
                doLogout, openMailboxDialog: openMailboxDialogHandler, switchMailbox, selectEmail, fetchEmails,
                formatDate, statusCls,
            };
        }
    });
    app.mount('#app');
    window.__app = app;
    refreshIcons();
    startPolling();
    console.log('[DBG-PAGE] 挂载: sent.js', location.pathname, import.meta.url.includes('?v=') ? '[PJAX重挂载]' : '[全量加载]');
}

export { boot, mount };

// 独立整页加载时自行挂载（无 ?v= → 非 PJAX 导入）
if (!import.meta.url.includes('v=')) boot().then(mount);