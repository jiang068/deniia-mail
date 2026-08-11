// ============================================================
//  应用入口：初始化 Vue + Vue Router
// ============================================================
import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import './assets/tailwind.css';
import './assets/styles.css';

// 发版后浏览器可能缓存了旧 index.html，导致按旧哈希动态加载的 JS 模块返回 MIME text/html
// 或请求失败，从而白屏卡死。这里监听相关事件并自动刷新，拉取最新 index.html 与资源映射。
window.addEventListener('vite:preload-error', (event) => {
  if (event?.preventDefault) event.preventDefault();
  window.location.reload();
});

router.onError((error) => {
  const msg = (error && error.message) ? error.message : '';
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed')
  ) {
    window.location.reload();
  }
});

const app = createApp(App);
app.use(router);
app.mount('#app');