// 同步执行于 <head>，防止主题闪烁 (FOUC)。
// 仅设置 data-theme 与 --c-accent；语义变量在 styles.css 中按主题取值。
(function () {
    var KEY = 'deniia_theme', PACK_KEY = 'deniia_theme_pack', BG_KEY = 'deniia_background_image', BG_OPACITY_KEY = 'deniia_background_opacity', UI_OPACITY_KEY = 'deniia_ui_opacity', BUTTON_OPACITY_KEY = 'deniia_button_opacity', BUTTON_HOVER_OPACITY_KEY = 'deniia_button_hover_opacity';
    var L_KEY = 'deniia_accent_light', D_KEY = 'deniia_accent_dark';
    // localStorage 可能被浏览器拦截而抛错（如 Edge Tracking Prevention），安全包裹，失败则用默认
    var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
    var mode = get(KEY) === 'dark' ? 'dark' : 'light';
    var pack = get(PACK_KEY) || 'deniia';
    var defaults = {
        deniia: { light: '#ec4899', dark: '#a78bfa' },
        ocean: { light: '#0f8ea3', dark: '#49c9d8' },
    };
    var def = (defaults[pack] && defaults[pack][mode]) || (mode === 'dark' ? '#8b5cf6' : '#ec4899');
    var scopedKey = 'deniia_accent_' + pack + '_' + mode;
    var legacy = pack === 'deniia' ? get(mode === 'dark' ? D_KEY : L_KEY) : null;
    var acc = get(scopedKey) || legacy || def;
    var root = document.documentElement;
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-theme-pack', pack);
    root.style.setProperty('--c-accent', acc);
    var savedOpacity = parseFloat(get(BG_OPACITY_KEY));
    var opacity = isFinite(savedOpacity) ? Math.min(0.8, Math.max(0.1, savedOpacity)) : (mode === 'dark' ? 0.65 : 0.55);
    root.style.setProperty('--c-bg-opacity', String(opacity));
    var savedUiOpacity = parseFloat(get(UI_OPACITY_KEY));
    var uiOpacity = isFinite(savedUiOpacity) ? Math.min(1, Math.max(0.45, savedUiOpacity)) : 0.88;
    root.style.setProperty('--c-ui-opacity', Math.round(uiOpacity * 100) + '%');
    var savedButtonOpacity = parseFloat(get(BUTTON_OPACITY_KEY));
    var buttonOpacity = isFinite(savedButtonOpacity) ? Math.min(1, Math.max(0.35, savedButtonOpacity)) : 0.82;
    root.style.setProperty('--c-button-opacity', Math.round(buttonOpacity * 100) + '%');
    var savedButtonHoverOpacity = parseFloat(get(BUTTON_HOVER_OPACITY_KEY));
    var buttonHoverOpacity = isFinite(savedButtonHoverOpacity) ? Math.min(1, Math.max(0.35, savedButtonHoverOpacity)) : 0.60;
    root.style.setProperty('--c-button-hover-opacity', Math.round(buttonHoverOpacity * 100) + '%');
    var bg = get(BG_KEY) || '';
    if (/^https:\/\//i.test(bg) || /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(bg)) {
        root.style.setProperty('--c-bg-image', 'url(' + JSON.stringify(bg) + ')');
    }
})();
