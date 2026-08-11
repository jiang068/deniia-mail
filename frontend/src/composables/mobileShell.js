// ============================================================
//  移动端壳 composable：响应式断点检测 + 抽屉侧栏状态
//  由原 multi-page 的 mobile-shell.js 迁移而来。SPA 中侧栏统一放
//  在 App.vue，这里只提供共享响应式状态与计算类，遮罩由 App.vue 声明式渲染。
// ============================================================
import { ref, computed } from 'vue';

const MOBILE_QUERY = '(max-width: 767.9px)';

function detect() {
    return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
}

// 响应式断点
const isMobile = ref(detect());
if (typeof window !== 'undefined') {
    try {
        const mq = window.matchMedia(MOBILE_QUERY);
        const onChange = (e) => { isMobile.value = e.matches; };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
    } catch (e) { /* ignore */ }
}

// 抽屉开合状态（全局共享）
const sidebarOpen = ref(false);
function toggleDrawer() { sidebarOpen.value = !sidebarOpen.value; }
function closeDrawer() { sidebarOpen.value = false; }

// 给侧栏 aside 用的 class：桌面常驻静态侧栏；移动端变 fixed 滑出抽屉
const mobileSidebarCls = computed(() => {
    return !isMobile.value
        ? 'w-64 flex-shrink-0 md:flex md:flex-col justify-between p-4 overflow-y-auto sidebar min-h-screen'
        : [
            'fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] flex flex-col justify-between p-4 overflow-y-auto sidebar',
            'transition-transform duration-200 ease-out',
            sidebarOpen.value ? 'translate-x-0 shadow-panel' : '-translate-x-full',
        ].join(' ');
});

export { isMobile, sidebarOpen, toggleDrawer, closeDrawer, mobileSidebarCls };