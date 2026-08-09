// ============================================================
//  共享「移动端壳」：响应式断点检测 + 抽屉侧栏状态 + 顶部汉堡栏 + 遮罩
//  挂载点独立于 #app（汉堡按钮与遮罩直接挂在 document.body，
//  不随各页面首屏渲染），PJAX 换页/切页时不重建、不闪现。
//
//  用法（各受保护页在 #app 里已有 side 结构）：
//    import { isMobile, sidebarOpen, toggleDrawer, closeDrawer, mountMobileTopbar } from './mobile-shell.js'
//    - 把常驻侧栏 `aside` 加 :class="[mobileSidebarCls]"  -> 移动端变抽屉、桌面保持定位
//    - 主体的列表/详情列加 :class 用 isMobile 决定全屏切换
//    - 页面 <main> 顶部加汉堡（用 isMobile 显示），汉堡 @click="toggleDrawer"
//  对外：
//    isMobile:    Vue ref<boolean>，<768px 为 true，随窗口变化
//    sidebarOpen: Vue ref<boolean>，抽屉开合（跨 PJAX 复用）
//    toggleDrawer / closeDrawer
//    mobileSidebarCls: computed class 串（desc: aside 在桌面常驻、移动端滑出抽屉）
// ============================================================
const { ref, computed } = window.Vue;

const MOBILE_QUERY = '(max-width: 767.9px)';

function detect() {
    return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
}

// 响应式断点
const isMobile = ref(detect());
try {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => { isMobile.value = e.matches; };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
} catch (e) { /* ignore */ }

// 抽屉开合状态（跨 PJAX 导航保留，避免切到别的页面时抽屉遗留半开）
const sidebarOpen = ref(false);

function toggleDrawer() { sidebarOpen.value = !sidebarOpen.value; }
function closeDrawer() { sidebarOpen.value = false; }

// 给侧栏 aside 用的 class：桌面（>=md）常驻 w-64 静态布局；
// 移动端（<md）变 fixed 滑出抽屉：初始 -translate-x-full（收在左侧外），打开时平移出来。
const mobileSidebarCls = computed(() => {
    return !isMobile.value
        ? 'w-64 flex-shrink-0 md:flex md:flex-col justify-between p-4 overflow-y-auto sidebar min-h-screen'
        : [
            'fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] flex flex-col justify-between p-4 overflow-y-auto sidebar',
            'transition-transform duration-200 ease-out',
            sidebarOpen.value ? 'translate-x-0 shadow-panel' : '-translate-x-full',
        ].join(' ');
});

// 遮罩（桌面无，移动端抽屉打开时显示、点击关闭）。
// 单一共享遮罩挂 body，避免多页各自造一个。
let overlayEl = null;
function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'mobile-drawer-overlay';
    overlayEl.style.cssText =
        'position:fixed;inset:0;z-index:30;background:rgba(0,0,0,0.45);' +
        'backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);' +
        'opacity:0;pointer-events:none;transition:opacity .2s ease;';
    overlayEl.addEventListener('click', closeDrawer);
    document.body.appendChild(overlayEl);
    return overlayEl;
}

function syncOverlay() {
    ensureOverlay();
    const open = isMobile.value && sidebarOpen.value;
    overlayEl.style.opacity = open ? '1' : '0';
    overlayEl.style.pointerEvents = open ? 'auto' : 'none';
}
try { window.Vue.watchEffect(syncOverlay); } catch (e) { /* ignore */ }

// 关闭：PJAX 换页前清抽屉态
window.addEventListener('pjax:before', closeDrawer);

// 每次 PJAX 挂载后根据当前视口重算一次遮罩
function refreshAfterMount() { syncOverlay(); }

export {
    isMobile, sidebarOpen,
    toggleDrawer, closeDrawer,
    mobileSidebarCls, refreshAfterMount,
};