// ============================================================
//  PJAX 模块化导航：点击站内页面链接时，仅替换 #app 内容并动态
//  加载目标页模块(app.js)，避免整页重载(不复下 Vue/Tailwind/DOMPurify)。
//  每个页面模块挂载后会将 app 存到 window.__app，供这里的卸载/重挂载使用。
// ============================================================

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
async function pjaxLoad(href, push) {
    if (window.__pjaxBusy) {
        // 正在切换：记录“最新想去哪”，结束后立即补上，而不整页刷新
        pendingTarget = href;
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
        pj('  ① fetch →', u.href);
        const res = await fetch(u.href, { headers: { 'X-PJAX': '1' } });
        if (!res.ok) throw new Error('fetch ' + res.status);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const appEl = doc.getElementById('app');
        if (!appEl) throw new Error('no #app in target');
        const appHtml = appEl.innerHTML;
        const appClass = (appEl && appEl.getAttribute('class')) || '';
        const title = (doc.querySelector('title') && doc.querySelector('title').textContent) || document.title;
        const bodyClass = (doc.body && doc.body.getAttribute('class')) || '';
        pj('  ② fetch 成功，取到 #app (title=', title, ')');

        // 卸载当前 Vue 应用
        if (window.__app) {
            try { window.__app.unmount(); } catch (e) { /* ignore */ }
            window.__app = null;
        }

        const root = document.getElementById('app');
        if (!root) throw new Error('no #app in current doc');
        // 淡入过渡：先置透明再替换，挂载后恢复
        document.body.classList.add('pjax-swap');
        // 关键：不同页面布局类不同（inbox 用 h-full flex-col，admin/settings 用 min-h-screen flex），
        // 必须同时应用目标页的 #app class，否则切到 admin/settings 时布局被上一页类撑坏、右侧空白。
        root.setAttribute('class', appClass);
        root.innerHTML = appHtml;
        document.body.setAttribute('class', bodyClass);
        document.body.classList.add('pjax-swap');

        if (push) history.pushState({}, '', u.href);
        else history.replaceState({}, '', u.href);
        document.title = title;
        window.scrollTo(0, 0);
        pj('  ③ pushState →', u.href);

        // 动态导入目标模块；查询串递增以强制重新执行(.mount)
        IMPORT_COUNTS[mod] = (IMPORT_COUNTS[mod] || 0) + 1;
        const modUrl = new URL(mod, location.href).href + '?v=' + IMPORT_COUNTS[mod];
        pj('  ④ 动态加载模块 →', modUrl);
        await import(modUrl);
        pj('  ⑤ 模块挂载完成（本轮 PJAX 结束）');

        // 挂载完成后淡入
        requestAnimationFrame(() => {
            document.body.classList.remove('pjax-swap');
        });
    } catch (err) {
        console.error('[DBG-PJAX] ⚠️ 切换失败，回退【整页加载】→', href, err);
        location.href = href;
    } finally {
        window.__pjaxBusy = false;
        // 若期间又点了别的目标，接着无缝跳过去（不整页刷新）
        if (pendingTarget) {
            const t = pendingTarget;
            pendingTarget = null;
            pj('  ⑥ 连点补跳 →', t);
            pjaxLoad(t, true);
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