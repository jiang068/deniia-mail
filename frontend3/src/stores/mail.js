// ============================================================
//  共享 Store（模块作用域响应式单例）
//  由原 multi-page 的 mail.js 迁移而来：从 CDN window.Vue 改为
//  本地 ESM import。主题/配置/登录态/邮箱/邮件渲染/API 全部集中于此，
//  Vue Router SPA 的任意组件通过 import { ... } 复用同一份响应式状态。
// ============================================================
import { ref, computed, nextTick } from 'vue';
import DOMPurify from 'dompurify';

// ---------- 主题系统 ----------
const THEME_KEY = 'deniia_theme';          // 'light' | 'dark'
const ACCENT_LIGHT_KEY = 'deniia_accent_light';
const ACCENT_DARK_KEY = 'deniia_accent_dark';

// 默认强调色：日间少女粉，夜间神秘紫
const DEFAULT_ACCENTS = { light: '#ec4899', dark: '#8b5cf6' };

// 预设主题色（用于设置页选择）
const ACCENT_PRESETS = [
    { name: '少女粉',   hex: '#ec4899' },
    { name: '神秘紫',   hex: '#8b5cf6' },
    { name: '清新蓝',   hex: '#3b82f6' },
    { name: '薄荷绿',   hex: '#10b981' },
    { name: '活力橙',   hex: '#f97316' },
    { name: '烈焰红',   hex: '#ef4444' },
    { name: '湖水青',   hex: '#06b6d4' },
    { name: '经典黑',   hex: '#1f2937' },
];

// ---------- 安全 localStorage 访问 ----------
function storeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
function storeSet(key, val) { try { window.localStorage.setItem(key, val); } catch (e) { /* storage 不可用则忽略 */ } }
function storeRemove(key) { try { window.localStorage.removeItem(key); } catch (e) { /* 忽略 */ } }

const theme = ref(storeGet(THEME_KEY) || 'light');
const accent = ref(getAccent(theme.value));

function getAccent(mode) {
    return storeGet(mode === 'dark' ? ACCENT_DARK_KEY : ACCENT_LIGHT_KEY) ||
        DEFAULT_ACCENTS[mode];
}

function applyTheme() {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme.value);
    root.style.setProperty('--c-accent', accent.value);
    root.style.setProperty('--c-accent-hover', shade(accent.value, -12));
    root.style.setProperty('--c-accent-soft', soft(accent.value));
    storeSet(THEME_KEY, theme.value);
    storeSet(theme.value === 'dark' ? ACCENT_DARK_KEY : ACCENT_LIGHT_KEY, accent.value);
}

function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt), g = clamp(((n >> 8) & 0xff) + amt), b = clamp((n & 0xff) + amt);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
function clamp(v) { return Math.max(0, Math.min(255, v)); }

function soft(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16), g = ((n >> 8) & 0xff), b = (n & 0xff);
    const target = theme.value === 'dark' ? 38 : 250;
    return `rgba(${Math.round((r + target * 2.4) / 3.4)}, ${Math.round((g + target * 2.4) / 3.4)}, ${Math.round((b + target * 2.4) / 3.4)}, 0.35)`;
}

function setTheme(mode) {
    theme.value = mode;
    accent.value = getAccent(mode);
    applyTheme();
}

function setAccent(hex) {
    accent.value = hex;
    applyTheme();
}

applyTheme();

// ---------- 配置 / 基础状态 ----------
const baseUrl = ref('');
const defaultDomain = ref('your-domain.com');
const token = ref(storeGet('cf_mail_token') || '');
const currentUser = ref(storeGet('cf_mail_user') || '');
const isAdmin = ref(false);
const isAuthenticated = ref(false);

const configError = ref(false);
const configErrorMessage = ref('');

const authChecking = ref(false);
let lastAuthOkAt = 0;
const AUTH_TTL = 60 * 1000;
let configCacheAt = 0;
const CONFIG_TTL = 5 * 60 * 1000;

async function loadConfig(force = false) {
    if (!force && baseUrl.value && configCacheAt && Date.now() - configCacheAt < CONFIG_TTL) {
        return true;
    }
    try {
        let res = await fetch('config.json');
        if (!res.ok) throw new Error('未找到 config.json 配置文件');
        const cfg = await res.json();
        let url = (cfg.baseUrl || '').trim();
        if (url.endsWith('/')) url = url.slice(0, -1);
        if (!url || url.includes('your-worker-subdomain.workers.dev')) {
            throw new Error('请在 config.json 中写入真实的 Worker 地址');
        }
        baseUrl.value = url;
        if (cfg.defaultDomain) defaultDomain.value = cfg.defaultDomain.trim();
        configCacheAt = Date.now();
        configError.value = false;
        return true;
    } catch (err) {
        console.error('config error:', err);
        configError.value = true;
        configErrorMessage.value = err.message;
        return false;
    }
}

function authHeaders() {
    return { 'Authorization': `Bearer ${token.value}` };
}
function jsonHeaders(extra = {}) {
    return { 'Content-Type': 'application/json', ...authHeaders(), ...extra };
}

function clearAuth() {
    token.value = '';
    currentUser.value = '';
    isAdmin.value = false;
    isAuthenticated.value = false;
    lastAuthOkAt = 0;
    storeRemove('cf_mail_token');
    storeRemove('cf_mail_user');
}

// 校验登录态；返回是否已登录。SPA 中未登录由路由守卫重定向到 /login。
async function ensureAuth() {
    if (isAuthenticated.value === true && token.value && Date.now() - lastAuthOkAt < AUTH_TTL) {
        return true;
    }
    authChecking.value = true;
    isAuthenticated.value = false;
    if (!token.value || !currentUser.value) {
        authChecking.value = false;
        return false;
    }
    try {
        const res = await fetch(`${baseUrl.value}/api/mailboxes`, { headers: authHeaders() });
        if (res.ok) {
            isAuthenticated.value = true;
            lastAuthOkAt = Date.now();
            const data = await res.json();
            mailboxes.value = data.mailboxes || [];
            mailboxesAt = Date.now();
            const adminRes = await fetch(`${baseUrl.value}/api/admin/settings`, { headers: authHeaders() });
            isAdmin.value = adminRes.ok;
            await fetchQuota(true);
            authChecking.value = false;
            return true;
        }
        clearAuth();
        authChecking.value = false;
        return false;
    } catch {
        clearAuth();
        authChecking.value = false;
        return false;
    }
}

// ---------- 邮箱 ----------
const mailboxes = ref([]);
const selectedMailbox = ref(storeGet('cf_mail_selected') || '');
const quota = ref({ limit: 3, used: 0, remaining: 3 });

const currentMailbox = computed(() => {
    return selectedMailbox.value ||
        (currentUser.value ? `${currentUser.value}@${defaultDomain.value}` : '');
});

function setSelectedMailbox(addr) {
    selectedMailbox.value = addr;
    storeSet('cf_mail_selected', addr);
}

let mailboxesAt = 0, quotaAt = 0;
const SYNC_TTL = 30 * 1000;

async function fetchMailboxes(force = false) {
    if (!force && mailboxesAt && Date.now() - mailboxesAt < SYNC_TTL) return;
    try {
        const res = await fetch(`${baseUrl.value}/api/mailboxes`, { headers: authHeaders() });
        if (res.ok) {
            const data = await res.json();
            mailboxes.value = data.mailboxes || [];
            mailboxesAt = Date.now();
            if (mailboxes.value.length > 0 && !selectedMailbox.value) {
                setSelectedMailbox(mailboxes.value[0].address);
            } else if (selectedMailbox.value && !mailboxes.value.some(m => m.address === selectedMailbox.value)) {
                setSelectedMailbox(mailboxes.value[0]?.address || '');
            }
        }
    } catch (e) { console.error('fetch mailboxes error:', e); }
}

async function fetchQuota(force = false) {
    if (!force && quotaAt && Date.now() - quotaAt < SYNC_TTL) return;
    try {
        const res = await fetch(`${baseUrl.value}/api/user/quota`, { headers: authHeaders() });
        if (res.ok) { quota.value = await res.json(); quotaAt = Date.now(); }
    } catch (e) { /* silent */ }
}

function switchMailbox(address) {
    if (address === selectedMailbox.value) return;
    setSelectedMailbox(address);
}

// ---------- 导航 ----------
const navFolders = [
    { id: 'inbox', label: '收件箱', icon: 'inbox', path: '/inbox' },
    { id: 'sent',  label: '已发送', icon: 'send',  path: '/sent' },
];

// ---------- 工具 ----------
function formatDate(d) {
    if (!d) return '';
    return String(d).split(' ')[0] || String(d);
}

// 刷新 lucide 图标（data-lucide + createIcons 模式）
async function refreshIcons() {
    await nextTick();
    if (window.lucide) window.lucide.createIcons();
}

function showError(target, msg) { target.value = msg; }

// ---------- 邮件渲染（含外链追踪拦截 + 保留 head 样式） ----------
const remoteContentLevel = ref(0);

function isExternalUrl(src) { return /^https?:\/\//i.test(src); }

function sanitizeStyleUrls(styleText, allowRemote) {
    if (!/url\(/i.test(styleText)) return styleText;
    return styleText.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (m, q, url) => {
        const clean = url.trim();
        return isExternalUrl(clean) ? (allowRemote ? m : 'none') : m;
    });
}

function protectContent(rawHtml) {
    let html = rawHtml || '';
    const level = remoteContentLevel.value;
    const allowImages = level >= 1;
    const allowAll = level >= 2;

    const purifyCfg = {
        ADD_ATTR: ['target', 'data-original-src', 'data-original-srcset', 'data-blocked', 'data-level'],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'autofocus'],
    };
    html = DOMPurify.sanitize(html, purifyCfg);

    const doc = new DOMParser().parseFromString(html, 'text/html');
    let styleBlock = '';
    (doc.head ? doc.head.querySelectorAll('style') : []).forEach(st => {
        let css = st.textContent || '';
        css = css.replace(/@import\s+(?:url\(\s*)?['"]?https?:\/\/[^'")\s;]+/gi, '');
        if (!allowAll) css = css.replace(/url\(\s*['"]?https?:\/\/[^'")\s;]+/gi, 'url()');
        if (css.trim()) styleBlock += `<style>${css}</style>`;
    });

    let body = doc.body || doc;

    body.querySelectorAll('img, picture source, input[type="image"]').forEach(el => {
        const src = el.getAttribute('src') || '';
        const srcset = el.getAttribute('srcset') || '';
        const isExtern = isExternalUrl(src) || (srcset && /https?:\/\//i.test(srcset));
        if (!isExtern) return;
        if (allowImages) {
            const o = el.getAttribute('data-original-src');
            const os = el.getAttribute('data-original-srcset');
            if (o) el.setAttribute('src', o);
            if (os) el.setAttribute('srcset', os);
            el.removeAttribute('data-blocked');
            el.removeAttribute('data-original-src');
            el.removeAttribute('data-original-srcset');
        } else {
            if (isExternalUrl(src)) { el.setAttribute('data-original-src', src); el.removeAttribute('src'); }
            if (srcset && /https?:\/\//i.test(srcset)) { el.setAttribute('data-original-srcset', srcset); el.removeAttribute('srcset'); }
            el.setAttribute('data-blocked', '1');
        }
        el.removeAttribute('onerror');
    });
    body.querySelectorAll('img').forEach(img => {
        if (!isExternalUrl(img.getAttribute('src') || '')) img.removeAttribute('data-blocked');
    });

    body.querySelectorAll('*[style]').forEach(el => {
        const s = el.getAttribute('style') || '';
        if (/url\(/i.test(s) && /https?:\/\//i.test(s)) el.setAttribute('style', sanitizeStyleUrls(s, allowAll));
    });

    body.querySelectorAll('style').forEach(st => {
        if (allowAll) return;
        let css = st.textContent || '';
        css = css.replace(/@import\s+(?:url\(\s*)?['"]?https?:\/\/[^'")\s;]+/gi, '');
        css = css.replace(/url\(\s*['"]?https?:\/\/[^'")\s;]+/gi, 'url()');
        st.textContent = css;
    });

    body.querySelectorAll('video source, audio source').forEach(s => {
        const src = s.getAttribute('src') || '';
        if (isExternalUrl(src) && !allowAll) s.removeAttribute('src');
    });
    body.querySelectorAll('video, audio').forEach(m => {
        const src = m.getAttribute('src') || '';
        if (isExternalUrl(src) && !allowAll) m.removeAttribute('src');
    });

    body.querySelectorAll('a[href]').forEach(a => {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer nofollow');
    });

    return styleBlock + body.innerHTML;
}

// 检测是否含外链图片
function hasExternalImagesOf(html) {
    return /<img[^>]+(?:https?:)?\/\//i.test(html) ||
        /<source[^>]+srcset=.*https?:/i.test(html) ||
        /<input[^>]+type=["']?image[^>]+https?:/i.test(html);
}
// 检测是否含更隐蔽追踪（超出图片级别）
function hasAdvancedTrackersOf(html) {
    return /<style[^>]*>[\s\S]*@import/gi.test(html) ||
        /style=["'][^"']*url\(\s*https?:/i.test(html) ||
        /<video|<audio/i.test(html) ||
        /<link[^>]+rel=["']?(?:preload|prefetch)["']?/i.test(html);
}

export {
    // 主题
    theme, accent, ACCENT_PRESETS, DEFAULT_ACCENTS, setTheme, setAccent,
    // 配置/登录
    baseUrl, defaultDomain, token, currentUser, isAdmin, isAuthenticated, authChecking,
    configError, configErrorMessage, loadConfig, ensureAuth, clearAuth,
    authHeaders, jsonHeaders,
    // 邮箱
    mailboxes, selectedMailbox, quota, currentMailbox, fetchMailboxes, fetchQuota,
    switchMailbox, setSelectedMailbox,
    // 导航/工具
    navFolders, formatDate, refreshIcons, showError,
    // 安全存储
    storeGet, storeSet, storeRemove,
    // 邮件渲染
    remoteContentLevel, protectContent, hasExternalImagesOf, hasAdvancedTrackersOf,
};