// ============================================================
//  共享模块：配置 / 登录态 / 主题 / 邮箱 / 邮件渲染 / API
//  被各独立页面 (index/inbox, sent, compose, admin, settings) 引用。
//  依赖：全局 window.Vue（Vue3 global build）、window.DOMPurify、window.lucide
// ============================================================
const { ref, computed, nextTick } = window.Vue;

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
// 某些浏览器（Edge Tracking Prevention、隐私模式、禁用第三方存储等）会拦截
// localStorage 访问并抛出 SecurityError。若不拦截，mail.js 模块顶层的一处
// localStorage 就会拖垮整个 import 链，导致所有页面无法挂载（呈现无样式模板）。
// 这里统一 try/catch，存储不可用时静默降级（不崩溃、不丢功能，仅不持久化）。
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
    // 由强调色派生 hover 与软色
    root.style.setProperty('--c-accent-hover', shade(accent.value, -12));
    root.style.setProperty('--c-accent-soft', soft(accent.value));
    storeSet(THEME_KEY, theme.value);
    storeSet(theme.value === 'dark' ? ACCENT_DARK_KEY : ACCENT_LIGHT_KEY, accent.value);
}

// 使颜色变亮/变暗（amt 为负变暗），用于 hover。输入 #rrggbb。
function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt), g = clamp(((n >> 8) & 0xff) + amt), b = clamp((n & 0xff) + amt);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
function clamp(v) { return Math.max(0, Math.min(255, v)); }

// 生成柔和背景色（混合白色/黑色）
function soft(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16), g = ((n >> 8) & 0xff), b = (n & 0xff);
    const target = theme.value === 'dark' ? 38 : 250; // 分别向深浅混合
    return `rgba(${Math.round((r + target * 2.4) / 3.4)}, ${Math.round((g + target * 2.4) / 3.4)}, ${Math.round((b + target * 2.4) / 3.4)}, 0.35)`;
}

// 页面进入前同步，避免主题闪烁（须尽快执行）
function initTheme() {
    // 先按已存主题 + 强调色设置 html
    const mode = storeGet(THEME_KEY) || 'light';
    const acc = getAccent(mode);
    const root = document.documentElement;
    root.setAttribute('data-theme', mode);
    root.style.setProperty('--c-accent', acc);
    root.style.setProperty('--c-accent-hover', shade(acc, -12));
    root.style.setProperty('--c-accent-soft', soft(acc));
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

// 模块加载时同步派生色（hover/soft），boot 脚本已处理 FOUC
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

// 仅当真正需要网络校验登录态时为 true（用于受保护页的整页"加载中"门控）。
// 快路径（复用已校验登录态）时保持 false，从而 PJAX 切换不会闪现加载态。
const authChecking = ref(false);
// 最近一次成功校验登录态的时间戳，用于 TTL 内快路径复用，避免切页时反复打 API + 闪登录页。
let lastAuthOkAt = 0;
const AUTH_TTL = 60 * 1000;
// config.json 缓存（静态文件，PJAX 挂载不必反复拉取）
let configCacheAt = 0;
const CONFIG_TTL = 5 * 60 * 1000;

async function loadConfig(force = false) {
    // 配置缓存：config.json 是静态文件，PJAX 多次挂载不必反复拉取。
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

// 校验登录态；返回是否已登录。未登录时可选重定向到登录页。
async function ensureAuth(redirectOnFail = true) {
    // 快路径：本会话已确认真实有效且未过期 → 直接返回，不重设为 false、不复发 API。
    // 这是 PJAX 切页不闪登录页/不闪"加载中"的关键。
    if (isAuthenticated.value === true && token.value && Date.now() - lastAuthOkAt < AUTH_TTL) {
        return true;
    }
    authChecking.value = true;
    isAuthenticated.value = false;
    if (!token.value || !currentUser.value) {
        authChecking.value = false;
        if (redirectOnFail) location.href = 'login.html';
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
        if (redirectOnFail) location.href = 'login.html';
        return false;
    } catch {
        clearAuth();
        authChecking.value = false;
        if (redirectOnFail) location.href = 'login.html';
        return false;
    }
}

// ---------- 邮箱 ----------
const mailboxes = ref([]);
// 当前邮箱持久化，便于多个子页共享
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

// 邮箱/配额数据新鲜度：PJAX 多次挂载在 TTL 内直接复用，避免每个页面重复拉同一堆 API。
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

async function switchMailbox(address) {
    if (address === selectedMailbox.value) return;
    setSelectedMailbox(address);
}

// ---------- 导航 ----------
const navFolders = [
    { id: 'inbox', label: '收件箱', icon: 'inbox', page: 'inbox.html' },
    { id: 'sent',  label: '已发送', icon: 'send',  page: 'sent.html' },
];

// 活跃导航：由当前页面标识决定
function navActive(pageId) {
    return navFolders.find(f => f.id === pageId);
}

// ---------- 工具 ----------
function formatDate(d) {
    if (!d) return '';
    return String(d).split(' ')[0] || String(d);
}

function refreshIcons() {
    nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
}

function showError(target, msg) { target.value = msg; }

// ---------- 邮件渲染（含外链追踪拦截 + 保留 head 样式） ----------
// 三级：0=全拦截 1=仅图片 2=全部
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

    // 1) DOMPurify 清洗（可执行内容剥除，保留排版样式）
    const purifyCfg = {
        ADD_ATTR: ['target', 'data-original-src', 'data-original-srcset', 'data-blocked', 'data-level'],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'autofocus'],
    };
    if (window.DOMPurify) html = window.DOMPurify.sanitize(html, purifyCfg);

    // 2) 解析，保留 <head><style>（很多 HTML 邮件的排版都在 head 里）
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let styleBlock = '';
    (doc.head ? doc.head.querySelectorAll('style') : []).forEach(st => {
        // 清洗 head 样式中的远程 @import 与 url()
        let css = st.textContent || '';
        css = css.replace(/@import\s+(?:url\(\s*)?['"]?https?:\/\/[^'")\s;]+/gi, '');
        if (!allowAll) css = css.replace(/url\(\s*['"]?https?:\/\/[^'")\s;]+/gi, 'url()');
        if (css.trim()) styleBlock += `<style>${css}</style>`;
    });

    let body = doc.body || doc;

    // 3) 图片外链
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

    // 4) 内联 style 远程 url()
    body.querySelectorAll('*[style]').forEach(el => {
        const s = el.getAttribute('style') || '';
        if (/url\(/i.test(s) && /https?:\/\//i.test(s)) el.setAttribute('style', sanitizeStyleUrls(s, allowAll));
    });

    // 5) body 内 <style>（与 head 相同处理）
    body.querySelectorAll('style').forEach(st => {
        if (allowAll) return;
        let css = st.textContent || '';
        css = css.replace(/@import\s+(?:url\(\s*)?['"]?https?:\/\/[^'")\s;]+/gi, '');
        css = css.replace(/url\(\s*['"]?https?:\/\/[^'")\s;]+/gi, 'url()');
        st.textContent = css;
    });

    // 6) 媒体外链
    body.querySelectorAll('video source, audio source').forEach(s => {
        const src = s.getAttribute('src') || '';
        if (isExternalUrl(src) && !allowAll) s.removeAttribute('src');
    });
    body.querySelectorAll('video, audio').forEach(m => {
        const src = m.getAttribute('src') || '';
        if (isExternalUrl(src) && !allowAll) m.removeAttribute('src');
    });

    // 7) 外链 <a> 防反向 tabnabbing
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
    theme, accent, ACCENT_PRESETS, DEFAULT_ACCENTS, initTheme, setTheme, setAccent,
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