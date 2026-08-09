// ============================================================
//  应用入口：初始化 Vue + Vue Router
// ============================================================
import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import './assets/tailwind.css';
import './assets/styles.css';

const app = createApp(App);
app.use(router);
app.mount('#app');