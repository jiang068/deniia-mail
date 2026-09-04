// ============================================================
//  Vue Router 路由定义（懒加载提高首屏速度）
//  Home=/ 登录/注册 与受保护的邮件区：受保护区包在 ShellLayout 下，
//  共享侧栏/顶栏零重绘；/login 与 / 为无壳独立页。
// ============================================================
import { createRouter, createWebHistory } from 'vue-router';
import { loadConfig, ensureAuth, beginLoading, endLoading } from '../stores/mail.js';

const routes = [
    {
        path: '/',
        name: 'home',
        component: () => import('../views/HomeView.vue'),
    },
    {
        path: '/login',
        name: 'login',
        component: () => import('../views/LoginView.vue'),
    },
    {
        path: '/',
        component: () => import('../layouts/ShellLayout.vue'),
        meta: { requiresAuth: true },
        children: [
            { path: 'inbox', name: 'inbox', component: () => import('../views/InboxView.vue') },
            { path: 'sent', name: 'sent', component: () => import('../views/SentView.vue') },
            { path: 'mailboxes', name: 'mailboxes', component: () => import('../views/MailboxesView.vue') },
            { path: 'compose', name: 'compose', component: () => import('../views/ComposeView.vue'), props: route => ({ to: route.query.to, subject: route.query.subject, forward: route.query.forward, from: route.query.from }) },
            { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
            { path: 'admin', name: 'admin', component: () => import('../views/AdminView.vue') },
            { path: 'admin/mailboxes', name: 'adminMailboxes', component: () => import('../views/AdminMailboxesView.vue') },
        ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/inbox' },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

// 全局前置守卫：受保护路由需已登录。登录态用 ensureAuth 校验（带 TTL 快路径）。
router.beforeEach(async (to) => {
    // 在路由解析和组件切换前就显示全局加载层，避免新页面先露出空壳。
    beginLoading('正在切换页面…', { immediate: true });
    await loadConfig();
    if (to.meta.requiresAuth) {
        const ok = await ensureAuth();
        if (!ok) return { name: 'login', query: { redirect: to.fullPath } };
    }
    return true;
});

// 直到异步组件和其余路由守卫都完成后才关闭，覆盖完整的页面切换过程。
// 延迟一个宏任务，让新页面的 onMounted 请求先接上同一加载计数，避免闪退后再次弹出。
router.afterEach(() => setTimeout(endLoading, 0));
router.onError(() => endLoading());

export default router;
