// 同步执行于 <head>，防止主题闪烁 (FOUC)。
// 仅设置 data-theme 与 --c-accent；语义变量在 styles.css 中按主题取值。
(function () {
    var KEY = 'deniia_theme', L_KEY = 'deniia_accent_light', D_KEY = 'deniia_accent_dark';
    // localStorage 可能被浏览器拦截而抛错（如 Edge Tracking Prevention），安全包裹，失败则用默认
    var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
    var mode = get(KEY) || 'light';
    var def = mode === 'dark' ? '#8b5cf6' : '#ec4899';
    var acc = get(mode === 'dark' ? D_KEY : L_KEY) || def;
    var root = document.documentElement;
    root.setAttribute('data-theme', mode);
    root.style.setProperty('--c-accent', acc);
})();