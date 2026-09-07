// ============================================================
//  共享 Store（模块作用域响应式单例）
//  由原 multi-page 的 mail.js 迁移而来：从 CDN window.Vue 改为
//  本地 ESM import。主题/配置/登录态/邮箱/邮件渲染/API 全部集中于此，
//  Vue Router SPA 的任意组件通过 import { ... } 复用同一份响应式状态。
// ============================================================
import { ref, computed, nextTick } from 'vue';
import DOMPurify from 'dompurify';
import {
    createIcons, AlertTriangle, BarChart3, Calendar, CheckCircle2, ChevronLeft,
    Feather, Filter, Forward, Gift, Globe, Inbox, List, LogOut, Mail, MailCheck,
    MailOpen, Menu, Palette, RefreshCw, Reply, Search, Send, Settings, Shield,
    ShieldAlert, ShieldX, Shuffle, SquarePen, SquarePlus, Trash2, Users,
} from 'lucide';
import { themePacks, themePackMap, defaultThemePack } from '../themes/index.js';

const iconSet = {
    AlertTriangle, BarChart3, Calendar, CheckCircle2, ChevronLeft, Feather, Filter,
    Forward, Gift, Globe, Inbox, List, LogOut, Mail, MailCheck, MailOpen, Menu,
    Palette, RefreshCw, Reply, Search, Send, Settings, Shield, ShieldAlert, ShieldX,
    Shuffle, SquarePen, SquarePlus, Trash2, Users,
};

// ---------- 主题系统 ----------
const THEME_KEY = 'deniia_theme';          // 'light' | 'dark'
const THEME_PACK_KEY = 'deniia_theme_pack';
const ACCENT_LIGHT_KEY = 'deniia_accent_light';
const ACCENT_DARK_KEY = 'deniia_accent_dark';
const BACKGROUND_KEY = 'deniia_background_image';
const BACKGROUND_OPACITY_KEY = 'deniia_background_opacity';
const UI_OPACITY_KEY = 'deniia_ui_opacity';
const BUTTON_OPACITY_KEY = 'deniia_button_opacity';
const BUTTON_HOVER_OPACITY_KEY = 'deniia_button_hover_opacity';

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

const theme = ref(storeGet(THEME_KEY) === 'dark' ? 'dark' : 'light');
const themePackId = ref(storeGet(THEME_PACK_KEY) || defaultThemePack.id);
const activeTheme = computed(() => themePackMap[themePackId.value] || defaultThemePack);
const brandName = computed(() => activeTheme.value.brand.name);
const brandShortName = computed(() => activeTheme.value.brand.shortName);
const brandTagline = computed(() => activeTheme.value.brand.tagline);
const brandDescription = computed(() => activeTheme.value.brand.description);
const backgroundImage = ref(normalizeBackgroundImage(storeGet(BACKGROUND_KEY) || ''));
const backgroundOpacity = ref(normalizeBackgroundOpacity(storeGet(BACKGROUND_OPACITY_KEY), theme.value));
const uiOpacity = ref(normalizeUiOpacity(storeGet(UI_OPACITY_KEY)));
const buttonOpacity = ref(normalizeButtonOpacity(storeGet(BUTTON_OPACITY_KEY)));
const buttonHoverOpacity = ref(normalizeButtonHoverOpacity(storeGet(BUTTON_HOVER_OPACITY_KEY)));
const accent = ref(getAccent(theme.value));

function accentKey(packId, mode) { return `deniia_accent_${packId}_${mode}`; }

function getAccent(mode, pack = activeTheme.value) {
    const legacy = pack.id === defaultThemePack.id
        ? storeGet(mode === 'dark' ? ACCENT_DARK_KEY : ACCENT_LIGHT_KEY)
        : '';
    const candidate = storeGet(accentKey(pack.id, mode)) || legacy ||
        pack?.modes?.[mode]?.['--c-accent'] || DEFAULT_ACCENTS[mode];
    return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : DEFAULT_ACCENTS[mode];
}

function applyTheme() {
    const root = document.documentElement;
    const vars = activeTheme.value.modes[theme.value] || {};
    Object.entries(vars).forEach(([key, value]) => root.style.setProperty(key, value));
    root.setAttribute('data-theme', theme.value);
    root.setAttribute('data-theme-pack', activeTheme.value.id);
    root.style.setProperty('--c-accent', accent.value);
    root.style.setProperty('--c-accent-hover', shade(accent.value, -12));
    root.style.setProperty('--c-accent-soft', soft(accent.value));
    root.style.setProperty('--c-accent-ink', contrastInk(accent.value));
    root.style.setProperty('--c-danger-ink', contrastInk(vars['--c-danger'] || '#e11d48'));
    root.style.setProperty('--c-bg-opacity', String(backgroundOpacity.value));
    root.style.setProperty('--c-ui-opacity', `${Math.round(uiOpacity.value * 100)}%`);
    root.style.setProperty('--c-button-opacity', `${Math.round(buttonOpacity.value * 100)}%`);
    root.style.setProperty('--c-button-hover-opacity', `${Math.round(buttonHoverOpacity.value * 100)}%`);
    root.style.setProperty('--c-bg-image', backgroundImage.value ? `url(${JSON.stringify(backgroundImage.value)})` : 'none');
    storeSet(THEME_KEY, theme.value);
    storeSet(THEME_PACK_KEY, activeTheme.value.id);
    storeSet(accentKey(activeTheme.value.id, theme.value), accent.value);
    // 保留默认主题的旧键，兼容已有版本的本地设置迁移。
    if (activeTheme.value.id === defaultThemePack.id) {
        storeSet(theme.value === 'dark' ? ACCENT_DARK_KEY : ACCENT_LIGHT_KEY, accent.value);
    }
    document.title = activeTheme.value.brand.name;
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

function setThemePack(id) {
    if (!themePackMap[id]) return;
    themePackId.value = id;
    accent.value = getAccent(theme.value);
    applyTheme();
}

function setAccent(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    accent.value = hex;
    applyTheme();
}

function contrastInk(hex) {
    const n = parseInt(hex.slice(1), 16);
    const channels = [n >> 16, (n >> 8) & 0xff, n & 0xff].map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const bgLuminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    const darkLuminance = 0.015;
    const whiteContrast = (1 + 0.05) / (bgLuminance + 0.05);
    const darkContrast = (Math.max(bgLuminance, darkLuminance) + 0.05) /
        (Math.min(bgLuminance, darkLuminance) + 0.05);
    return whiteContrast >= darkContrast ? '#ffffff' : '#17202a';
}

function normalizeBackgroundImage(value) {
    const image = String(value || '').trim();
    if (!image) return '';
    if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(image)) return image;
    try {
        const url = new URL(image, window.location.origin);
        return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
}

function normalizeBackgroundOpacity(value, mode = 'light') {
    const fallback = mode === 'dark' ? 0.65 : 0.55;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.round(Math.min(0.8, Math.max(0.1, number)) * 100) / 100;
}

function normalizeUiOpacity(value) {
    const fallback = 0.88;
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.round(Math.min(1, Math.max(0.45, number)) * 100) / 100;
}

function normalizeButtonOpacity(value) {
    const fallback = 0.82;
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.round(Math.min(1, Math.max(0.35, number)) * 100) / 100;
}

function normalizeButtonHoverOpacity(value) {
    const fallback = 0.60;
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const stepped = Math.round(number / 0.05) * 0.05;
    return Math.round(Math.min(1, Math.max(0.35, stepped)) * 100) / 100;
}

function setBackgroundImage(value) {
    backgroundImage.value = normalizeBackgroundImage(value);
    storeSet(BACKGROUND_KEY, backgroundImage.value);
    applyTheme();
}

function setBackgroundOpacity(value) {
    backgroundOpacity.value = normalizeBackgroundOpacity(value, theme.value);
    storeSet(BACKGROUND_OPACITY_KEY, String(backgroundOpacity.value));
    applyTheme();
}

function setUiOpacity(value) {
    uiOpacity.value = normalizeUiOpacity(value);
    storeSet(UI_OPACITY_KEY, String(uiOpacity.value));
    applyTheme();
}

function setButtonOpacity(value) {
    buttonOpacity.value = normalizeButtonOpacity(value);
    storeSet(BUTTON_OPACITY_KEY, String(buttonOpacity.value));
    applyTheme();
}

function setButtonHoverOpacity(value) {
    buttonHoverOpacity.value = normalizeButtonHoverOpacity(value);
    storeSet(BUTTON_HOVER_OPACITY_KEY, String(buttonHoverOpacity.value));
    applyTheme();
}

function clearBackgroundImage() {
    setBackgroundImage('');
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
let configRequest = null;
let authRequest = null;
let mailboxesRequest = null;
let quotaRequest = null;
const API_TIMEOUT = 15000;
const loadingVisible = ref(false);
const loadingMessage = ref('正在加载…');
let loadingCount = 0;
let loadingShowTimer = null;

function beginLoading(message = '正在加载…', { immediate = false } = {}) {
    loadingCount += 1;
    if (loadingCount === 1) {
        loadingMessage.value = message;
        if (immediate) {
            loadingVisible.value = true;
        } else {
            loadingShowTimer = setTimeout(() => { loadingVisible.value = true; }, 160);
        }
    }
}

function endLoading() {
    loadingCount = Math.max(0, loadingCount - 1);
    if (loadingCount !== 0) return;
    if (loadingShowTimer) clearTimeout(loadingShowTimer);
    loadingShowTimer = null;
    loadingVisible.value = false;
}

async function loadConfig(force = false) {
    if (!force && baseUrl.value && configCacheAt && Date.now() - configCacheAt < CONFIG_TTL) {
        return true;
    }
    if (configRequest) return configRequest;
    configRequest = (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        let res;
        try { res = await fetch('config.json', { signal: controller.signal, cache: 'no-store' }); }
        finally { clearTimeout(timer); }
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
      } finally {
        configRequest = null;
      }
    })();
    return configRequest;
}

function authHeaders() {
    return { 'Authorization': `Bearer ${token.value}` };
}
function jsonHeaders(extra = {}) {
    return { 'Content-Type': 'application/json', ...authHeaders(), ...extra };
}

async function apiFetch(path, options = {}) {
    const { auth = true, timeout = API_TIMEOUT, loading = true, loadingText = '正在加载…', signal: externalSignal, ...init } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeout);
    let onAbort;
    if (externalSignal) {
        onAbort = () => controller.abort(externalSignal.reason || 'aborted');
        if (externalSignal.aborted) onAbort();
        else externalSignal.addEventListener('abort', onAbort, { once: true });
    }
    const headers = new Headers(init.headers || {});
    if (auth && token.value) headers.set('Authorization', `Bearer ${token.value}`);
    if (loading) beginLoading(loadingText);
    try {
        return await fetch(`${baseUrl.value}${path}`, { ...init, headers, signal: controller.signal });
    } finally {
        if (loading) endLoading();
        clearTimeout(timer);
        if (externalSignal && onAbort) externalSignal.removeEventListener('abort', onAbort);
    }
}

function clearAuth() {
    token.value = '';
    currentUser.value = '';
    isAdmin.value = false;
    isAuthenticated.value = false;
    lastAuthOkAt = 0;
    mailboxes.value = [];
    quota.value = { limit: 3, used: 0, remaining: 3 };
    mailboxesAt = 0;
    quotaAt = 0;
    setSelectedMailbox('');
    storeRemove('cf_mail_token');
    storeRemove('cf_mail_user');
}

// 校验登录态；返回是否已登录。SPA 中未登录由路由守卫重定向到 /login。
async function ensureAuth(force = false) {
    if (!force && isAuthenticated.value === true && token.value && Date.now() - lastAuthOkAt < AUTH_TTL) {
        return true;
    }
    if (authRequest) return authRequest;
    authRequest = (async () => {
    authChecking.value = true;
    isAuthenticated.value = false;
    if (!token.value || !currentUser.value) {
        authChecking.value = false;
        return false;
    }
    try {
        const res = await apiFetch('/api/me');
        if (res.ok) {
            const data = await res.json();
            const profile = data.user || {};
            currentUser.value = profile.username || currentUser.value;
            isAdmin.value = profile.role === 'admin';
            mailboxes.value = data.mailboxes || [];
            mailboxesAt = Date.now();
            if (data.quota) { quota.value = data.quota; quotaAt = Date.now(); }
            authChecking.value = false;
            isAuthenticated.value = true;
            lastAuthOkAt = Date.now();
            storeSet('cf_mail_user', currentUser.value);
            if (mailboxes.value.length > 0 && !selectedMailbox.value) {
                setSelectedMailbox(mailboxes.value[0].address);
            } else if (selectedMailbox.value && !mailboxes.value.some(m => m.address === selectedMailbox.value)) {
                setSelectedMailbox(mailboxes.value[0]?.address || '');
            }
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
    })();
    try { return await authRequest; }
    finally { authRequest = null; }
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
    if (mailboxesRequest) return mailboxesRequest;
    mailboxesRequest = (async () => { try {
        const res = await apiFetch('/api/mailboxes');
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
    })();
    try { await mailboxesRequest; } finally { mailboxesRequest = null; }
}

async function fetchQuota(force = false) {
    if (!force && quotaAt && Date.now() - quotaAt < SYNC_TTL) return;
    if (quotaRequest) return quotaRequest;
    quotaRequest = (async () => { try {
        const res = await apiFetch('/api/user/quota');
        if (res.ok) { quota.value = await res.json(); quotaAt = Date.now(); }
    } catch (e) { /* silent */ }
    })();
    try { await quotaRequest; } finally { quotaRequest = null; }
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
let iconRefreshQueued = false;
async function refreshIcons() {
    if (iconRefreshQueued) return;
    iconRefreshQueued = true;
    try {
        await nextTick();
        createIcons({ icons: iconSet });
    } finally {
        iconRefreshQueued = false;
    }
}

function showError(target, msg) { target.value = msg; }

// ---------- 邮件渲染（含外链追踪拦截 + 保留 head 样式） ----------
const remoteContentLevel = ref(0);

// 远程 URL 既包括绝对地址，也包括协议相对地址（//cdn.example/...）。
function isExternalUrl(src) { return /^(?:https?:)?\/\//i.test(String(src || '').trim()); }

function sanitizeStyleUrls(styleText, allowRemote) {
    if (!/url\(/i.test(styleText)) return styleText;
    return styleText.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (m, q, url) => {
        const clean = url.trim();
        return isExternalUrl(clean) ? (allowRemote ? m : 'none') : m;
    });
}

function sanitizeEmail(rawHtml) {
    let html = rawHtml || '';
    const level = remoteContentLevel.value;
    const allowImages = level >= 1;
    const allowAll = level >= 2;

    const purifyCfg = {
        ADD_ATTR: ['target', 'data-original-src', 'data-original-srcset', 'data-blocked', 'data-level'],
        // 邮件正文通常把 CSS 放在 <head><style> 中；保留完整文档才能提取并重放这段 CSS。
        WHOLE_DOCUMENT: true,
        // link 在默认/仅图片模式下移除；用户明确选择“加载全部”时允许
        // 外链样式和预加载正常按浏览器行为工作，但仍禁止可执行/嵌入类标签。
        FORBID_TAGS: [
            'script', 'iframe', 'object', 'embed', 'form', 'base', 'meta',
            ...(allowAll ? [] : ['link']),
        ],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'autofocus'],
    };
    html = DOMPurify.sanitize(html, purifyCfg);

    const doc = new DOMParser().parseFromString(html, 'text/html');
    let styleBlock = '';
    (doc.head ? doc.head.querySelectorAll('style') : []).forEach(st => {
        let css = st.textContent || '';
        if (!allowAll) {
            css = css.replace(/@import\s+(?:url\(\s*)?['"]?(?:https?:)?\/\/[^'")\s;]+/gi, '');
            css = css.replace(/url\(\s*(['"]?)(?:https?:)?\/\/[^'")\s;]+\1\s*\)/gi, 'url()');
        }
        if (css.trim()) styleBlock += `<style>${css}</style>`;
    });

    let body = doc.body || doc;

    body.querySelectorAll('img, picture source, input[type="image"]').forEach(el => {
        const src = el.getAttribute('src') || '';
        const srcset = el.getAttribute('srcset') || '';
        const isExtern = isExternalUrl(src) || (srcset && /(?:https?:)?\/\//i.test(srcset));
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
        if (/url\(/i.test(s) && /(?:https?:)?\/\//i.test(s)) el.setAttribute('style', sanitizeStyleUrls(s, allowAll));
    });

    body.querySelectorAll('style').forEach(st => {
        if (allowAll) return;
        let css = st.textContent || '';
        css = css.replace(/@import\s+(?:url\(\s*)?['"]?(?:https?:)?\/\/[^'")\s;]+/gi, '');
        css = css.replace(/url\(\s*(['"]?)(?:https?:)?\/\/[^'")\s;]+\1\s*\)/gi, 'url()');
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

    return { styles: styleBlock, body: body.innerHTML };
}

function protectContent(rawHtml) {
    const r = sanitizeEmail(rawHtml);
    return r.styles + r.body;
}

// 供 iframe srcdoc 使用的完整独立 HTML 文档，隔离邮件样式，避免泄漏到应用 UI。
// 邮件里的全局选择器（如 body{...}、h1{...}）只在 iframe 文档内生效。
function buildEmailDocument(rawHtml) {
    const r = sanitizeEmail(rawHtml);
    const rootStyles = getComputedStyle(document.documentElement);
    const mailBg = rootStyles.getPropertyValue('--mail-body-bg').trim() || '#ffffff';
    const mailText = rootStyles.getPropertyValue('--mail-body-text').trim() || '#17202a';
    return `<!DOCTYPE html>
<html lang="zh-CN" style="margin:0;padding:0;">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root { color-scheme: light; }
  html, body { margin:0; padding:0; }
  body {
    background: ${mailBg};
    color: ${mailText};
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  /* 仅作为无样式邮件的兜底；:where() 保持零优先级，不压过邮件 CSS。 */
  :where(body img, body video) { max-width: 100%; height: auto; }
  :where(body table) { max-width: 100%; }
  :where(body pre, body code) { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
${r.styles}
</head>
<body>${r.body}</body>
</html>`;
}

// 取邮件详情中实际用于渲染的正文。检测和渲染必须使用同一份内容，
// 兼容不同版本接口/缓存中的 html、content、text 和 text_content 字段。
function getEmailContent(email) {
    if (!email) return '';
    return [email.html, email.content, email.text, email.text_content]
        .find(value => typeof value === 'string' && value.trim()) || '';
}

function containsRemoteUrl(value) {
    return /(?:https?:)?\/\/[^\s"'`()<>]+/i.test(String(value || ''));
}

// 检测是否含外链图片
function hasExternalImagesOf(html) {
    const source = String(html || '');
    return /<img\b[^>]*\bsrc\s*=\s*["'][^"']*(?:https?:)?\/\//i.test(source) ||
        /<img\b[^>]*\bsrcset\s*=\s*["'][^"']*(?:https?:)?\/\//i.test(source) ||
        /<source\b[^>]*\b(?:src|srcset)\s*=\s*["'][^"']*(?:https?:)?\/\//i.test(source) ||
        /<input\b[^>]*\btype\s*=\s*["']?image\b[^>]*\bsrc\s*=\s*["'][^"']*(?:https?:)?\/\//i.test(source);
}
// 检测是否含更隐蔽追踪（超出图片级别）
function hasAdvancedTrackersOf(html) {
    const source = String(html || '');
    const styleBlocks = source.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) || [];
    const inlineStyles = source.match(/\bstyle\s*=\s*["'][^"']*["']/gi) || [];
    return styleBlocks.some(block => /@import/i.test(block) || containsRemoteUrl(block)) ||
        inlineStyles.some(style => /url\s*\(/i.test(style) && containsRemoteUrl(style)) ||
        /<(?:video|audio)\b/i.test(source) ||
        /<link\b[^>]+\brel\s*=\s*["']?(?:preload|prefetch)["']?/i.test(source);
}

export {
    // 主题
    theme, accent, ACCENT_PRESETS, DEFAULT_ACCENTS, setTheme, setAccent,
    themePacks, themePackId, activeTheme, brandName, brandShortName, brandTagline, brandDescription,
    setThemePack, backgroundImage, setBackgroundImage, clearBackgroundImage,
    backgroundOpacity, setBackgroundOpacity,
    uiOpacity, setUiOpacity,
    buttonOpacity, setButtonOpacity,
    buttonHoverOpacity, setButtonHoverOpacity,
    // 配置/登录
    baseUrl, defaultDomain, token, currentUser, isAdmin, isAuthenticated, authChecking,
    configError, configErrorMessage, loadConfig, ensureAuth, clearAuth,
    authHeaders, jsonHeaders, apiFetch, loadingVisible, loadingMessage, beginLoading, endLoading,
    // 邮箱
    mailboxes, selectedMailbox, quota, currentMailbox, fetchMailboxes, fetchQuota,
    switchMailbox, setSelectedMailbox,
    // 导航/工具
    navFolders, formatDate, refreshIcons, showError,
    // 安全存储
    storeGet, storeSet, storeRemove,
    // 邮件渲染
    remoteContentLevel, protectContent, buildEmailDocument, getEmailContent, hasExternalImagesOf, hasAdvancedTrackersOf,
};
