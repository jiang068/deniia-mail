// ============================================================
//  PJAX 模块化导航：点击站内页面链接时，仅替换 #app 内容并动态
//  加载目标页模块，避免整页重载(不复下 Vue/Tailwind/DOMPurify)。
//
//  两相（Two-Phase）导航，消除白屏/闪烁（核心目标）：
//   所有页面模块统一导出 boot + mount：
//     - 独立整页加载：页面模块自检 import.meta.url 无 ?v= → 自行 boot().then(mount())
//       （恢复旧版可靠直载行为，不依赖 pjax）。
//     - PJAX 导航：import('js/X.js?v=N')（fresh 求值，无自挂载）→ pjax 显式调用
//       page.boot()（业务数据在旧页可见时预取）→ 原子替换 #app/body → page.mount()。
//   由此收件箱↔发件箱（共享同一 shell）切换时：界面保持在原页 → 数据拿到瞬间
//   右侧列表以已就绪数据无缝呈现，彻底消除"先清空再加载"的视觉断层与 opacity 硬淡出。
//
//  A/E（样式/图标保全）：仅替换 #app 容器（head 不重载，全局 CSS 一致）；
//     挂载完成后统一 refreshIcons()，防止 Lucide 图标掉落。
// ============================================================

// 切页前关闭移动端抽屉，避免遮罩/抽屉在 PJAX 换页后残留半开
import { closeDrawer } from './mobile-shell.js';
// 共享单例；import 即同一实例，用于切页后重建 Lucide 图标
import { refreshIcons } from './mail.js';

// 页面 HTML 文件名 → 其页面模块
const PAGES = {
    'index.html': 'js/index.js',
    'inbox.html': 'js/inbox.js',
    'login.html': 'js/login.js',
    'sent.html': 'js/sent.js',
    'compose.html': 'js/compose.js',
    'settings.html': 'js/settings.js',
    'admin.html': 'js/admin.js',
    '': 'js/index.js',
};

// 每个模块的导入计数，用于查询串缓存破坏，保证重复导航可重新挂载
const IMPORT_COUNTS = {};
const pj = (m, ...a) => { try { console.log('[DBG-PJAX]', m, ...a); } catch (e) {} };

function isOurPagePath(pathname) {
    const name = pathname.split('/').pop();
    return name === '' || name.endsWith('.html');
}

function moduleForPath(pathname) {
    const name = pathname.split('/').pop() || 'index.html';
    return PAGES[name] || (name.endsWith('.html') ? 'js/' + name.replace('.html', '.js') : null);
}

// 快速连点时合并到最新目标，避免回退整页重载（busy 时不再走 location.href）
let pendingTarget = null;

// 原子替换 DOM + body class + 历史记录。调用前必须已 await 数据就绪。
function applyShell(doc, push, u) {
    const appEl = doc.getElementById('app');
    const appHtml = appEl.innerHTML;
    const appClass = appEl.getAttribute('class') || '';
    const title = (doc.querySelector('title') && doc.querySelector('title').textContent) || document.title;
    const bodyClass = (doc.body && doc.body.getAttribute('class')) || '';

    // 卸载旧 Vue 实例
    if (window.__app) {
        try { window.__app.unmount(); } catch (e) { /* ignore */ }
        window.__app = null;
    }

    // 一次性原子化更新：innerHTML + #app class + body class。
    // 关键：不同页面布局类不同（inbox 用 h-full flex-col，admin/settings 用 min-h-screen flex），
    // 必须同时应用目标页 #app class，否则切到 admin/settings 时布局被上一页类撑坏、右侧空白。
    const root = document.getElementById('app');
    root.setAttribute('class', appClass);
    root.innerHTML = appHtml;
    document.body.setAttribute('class', bodyClass);
    // PJAX 已替换内容：收拢抽屉（若上一页是移动端抽屉打开态）
    closeDrawer();

    if (push) history.pushState({}, '', u.href);
    else history.replaceState({}, '', u.href);
    document.title = title;
    window.scrollTo(0, 0);
}

async function pjaxLoad(href, push) {
    if (window.__pjaxBusy) {
        // 正在切换：记录“最新想去哪”，结束后立即补上，而不整页刷新
        pendingTarget = { href, push };
        pj('BUSY 连点，暂存目标:', href);
        return;
    }
    window.__pjaxBusy = true;

    let u;
    try { u = new URL(href, location.href); } catch { window.__pjaxBusy = false; return; }
    if (u.origin !== location.origin) { window.__pjaxBusy = false; return; }

    const mod = moduleForPath(u.pathname);
    if (!mod) { window.__pjaxBusy = false; location.href = u.href; return; }
    pj('开始切换 →', u.pathname, 'push=' + push);

    try {
        // ① 拉取并解析目标页 HTML（此时旧页面保持不变）
        pj('  ① fetch →', u.href);
        const res = await fetch(u.href, { headers: { 'X-PJAX': '1' } });
        if (!res.ok) throw new Error('fetch ' + res.status);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        if (!doc.getElementById('app')) throw new Error('no #app in target');

        // ② import 目标模块（fresh 求值，仅定义 boot/mount，不挂载）
        IMPORT_COUNTS[mod] = (IMPORT_COUNTS[mod] || 0) + 1;
        const page = await import(new URL(mod, location.href).href + '?v=' + IMPORT_COUNTS[mod]);
        pj('  ② 模块已导入');

        // ③ 数据预载：await boot()，旧页面保持可见；数据就绪后再换 DOM
        if (page && typeof page.boot === 'function') {
            pj('  ③ 预载数据（旧页仍可见）…');
            await page.boot();
        }
        pj('  ④ 数据就绪，原子替换 + 挂载');

        // ④ 原子替换 + 挂载：旧页面保持到这一瞬，新页以已就绪数据瞬间呈现（无白屏/无淡出）
        applyShell(doc, push, u);
        if (page && typeof page.mount === 'function') {
            page.mount();
        }
        refreshIcons();
        requestAnimationFrame(() => { document.body.classList.remove('pjax-swap'); });
        pj('  ⑤ 本轮 PJAX 完成');
    } catch (err) {
        console.error('[DBG-PJAX] ⚠️ 切换失败，回退【整页加载】→', href, err);
        document.body.classList.remove('pjax-swap');
        location.href = href;
    } finally {
        window.__pjaxBusy = false;
        // 若期间又点了别的目标，接着无缝跳过去（不整页刷新）
        if (pendingTarget) {
            const t = pendingTarget;
            pendingTarget = null;
            pj('  ⑥ 连点补跳 →', t.href);
            pjaxLoad(t.href, t.push);
        }
    }
}

function samePage(u) {
    return u.origin === location.origin &&
        u.pathname === location.pathname &&
        u.search === location.search;
}

document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.target === '_blank' || a.target === '_top') return;
    if (a.hasAttribute('download')) return;
    const href = a.getAttribute('href') || '';
    if (!href || /^(https?:|mailto:|tel:|javascript:|data:)/i.test(href)) return;
    if (href.startsWith('#')) return;

    let u;
    try { u = new URL(href, location.href); } catch { return; }
    if (u.origin !== location.origin) return;
    if (!isOurPagePath(u.pathname)) return;

    if (samePage(u)) { e.preventDefault(); pj('点击已被拦截(同页):', href); return; }
    e.preventDefault();
    pj('点击已拦截，交给 pjax:', href);
    pjaxLoad(u.href, true);
});

window.addEventListener('popstate', () => {
    if (window.__pjaxBusy) return;
    if (!isOurPagePath(location.pathname)) return;
    pjaxLoad(location.href, false);
});