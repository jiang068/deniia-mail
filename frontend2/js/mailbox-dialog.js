// ============================================================
//  共享「新建邮箱」弹窗
//  挂载到 document.body（独立于 #app），首次打开时才创建 DOM。
//  好处：
//    - 不随任一页面首屏渲染 → 切页/首载不会闪现弹窗
//    - index/sent/compose 三页共用一套逻辑，不再三份重复
//  用法：
//    import { openMailboxDialog, closeMailboxDialog } from './mailbox-dialog.js'
//    openMailboxDialog({ onCreated, refreshIcons })
//      onCreated: 创建成功后的回调（用于刷新该页的邮件列表）
//      refreshIcons: 刷新 lucide 图标
// ============================================================
import { baseUrl, quota, defaultDomain, isAdmin, token, fetchQuota, setSelectedMailbox } from './mail.js';

let el = null;
let errEl = null;
let inputEl = null;
let opts = { onCreated: null, refreshIcons: null };

function showError(msg) { if (errEl) errEl.textContent = msg; }

function close() {
    if (el) el.style.display = 'none';
}
function closeMailboxDialog() { close(); }

function build() {
    el = document.createElement('div');
    el.className = 'fixed inset-0 z-50 flex items-center justify-center p-4';
    el.style.cssText = 'background: rgba(0,0,0,0.5); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); display:none;';
    el.innerHTML = `
        <div class="bg-surface rounded-xl shadow-panel w-full max-w-md p-6 space-y-5 border border-line">
            <div class="flex items-center justify-between">
                <h3 class="font-bold text-main text-base">新建邮箱</h3>
                <button type="button" data-act="close" class="text-faint hover:text-text-main"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div class="text-xs text-sub">已用 <span data-role="quota" class="font-medium text-main">-</span> 个</div>

            <button type="button" data-act="random" class="w-full text-left p-4 border border-line rounded-xl hover:border-accent hover:bg-accent-soft transition flex items-center space-x-3">
                <div class="p-2 bg-accent-soft text-accent rounded-lg"><i data-lucide="shuffle" class="w-5 h-5"></i></div>
                <div><p class="text-sm font-medium text-main">随机生成</p><p class="text-xs text-sub">例如 <span data-role="example">3f9k2a@domain</span></p></div>
            </button>

            <div class="border border-line rounded-xl p-4 space-y-3">
                <div class="flex items-center space-x-3">
                    <div class="p-2 bg-accent-soft text-accent rounded-lg"><i data-lucide="pencil" class="w-5 h-5"></i></div>
                    <p class="text-sm font-medium text-main">自定义名称</p>
                </div>
                <div class="flex items-center space-x-2">
                    <input type="text" data-role="input" placeholder="名称" class="flex-1 bg-surface2 text-main border border-line rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 ring-accent focus:outline-none">
                    <span class="text-sm text-faint font-mono">@<span data-role="domain"></span></span>
                </div>
                <button type="button" data-act="custom" class="w-full py-2 bg-accent hover-bg-accent-h text-accent-ink rounded-lg text-sm font-medium">创建</button>
                <p data-role="error" class="text-xs text-danger hidden"></p>
            </div>
        </div>`;
    document.body.appendChild(el);

    errEl = el.querySelector('[data-role="error"]');
    inputEl = el.querySelector('[data-role="input"]');
    el.querySelector('[data-role="domain"]').textContent = defaultDomain.value;
    el.querySelector('[data-role="example"]').textContent = '3f9k2a@' + defaultDomain.value;

    el.addEventListener('click', (e) => {
        const actBtn = e.target.closest('[data-act]');
        if (!actBtn) return;
        const act = actBtn.getAttribute('data-act');
        if (act === 'close') close();
        else if (act === 'random') createRandom();
        else if (act === 'custom') createCustom();
    });
    // 点遮罩关闭
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    // ESC 关闭
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    if (opts.refreshIcons) opts.refreshIcons();
}

function setQuotaText() {
    const q = el.querySelector('[data-role="quota"]');
    if (q) q.textContent = isAdmin.value ? '不限' : (quota.value.used + ' / ' + quota.value.limit);
}

function afterCreated(email) {
    close();
    errEl && (errEl.textContent = '');
    if (inputEl) inputEl.value = '';
    setSelectedMailbox(email);
    if (opts.onCreated) opts.onCreated(email);
}

async function createRandom() {
    showError('');
    try {
        const res = await fetch(`${baseUrl.value}/api/generate`, { headers: { Authorization: `Bearer ${token.value}` } });
        const data = await res.json().catch(() => ({}));
        if (data.email) { afterCreated(data.email); }
        else showError(data.error || '生成失败');
    } catch (e) { showError('生成失败: ' + e.message); }
}

async function createCustom() {
    const name = (inputEl ? inputEl.value : '').trim().toLowerCase();
    if (!name || !/^[a-z0-9._-]{1,64}$/.test(name)) {
        showError('名称只能包含小写字母、数字、.-_（最长 64 位）');
        return;
    }
    showError('');
    try {
        const res = await fetch(`${baseUrl.value}/api/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
            body: JSON.stringify({ local: name })
        });
        const data = await res.json().catch(() => ({}));
        if (data.email) { afterCreated(data.email); }
        else showError(data.error || '创建失败');
    } catch (e) { showError('创建失败: ' + e.message); }
}

async function openMailboxDialog(handlers = {}) {
    opts = { onCreated: handlers.onCreated || null, refreshIcons: handlers.refreshIcons || null };
    if (!el) build();
    // 刷新配额并检查上限
    await fetchQuota(true);
    if (!isAdmin.value && quota.value.remaining <= 0) {
        showError('邮箱数量已达上限（' + quota.value.limit + ' 个）');
        el.style.display = 'flex';
        return;
    }
    setQuotaText();
    showError('');
    el.style.display = 'flex';
}

export { openMailboxDialog, closeMailboxDialog };