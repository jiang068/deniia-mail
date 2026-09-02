<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  baseUrl, token, currentUser, isAdmin, isAuthenticated,
  configError, configErrorMessage, loadConfig, ensureAuth,
  refreshIcons, apiFetch, storeSet,
} from '../stores/mail.js';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const showRegister = ref(route.query.register === '1');
const errorMessage = ref('');
const loginForm = ref({ username: '', password: '' });
const registerForm = ref({ username: '', password: '', invite: '', setupToken: '' });
const isFirstRun = ref(false);
const checked = ref(false);
const setupCheckError = ref('');

async function checkSetup() {
  setupCheckError.value = '';
  try {
    const res = await apiFetch('/api/admin/check', { auth: false });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    // 后端以 users 表是否为空作为唯一初始化依据；无管理员不代表全新数据库。
    isFirstRun.value = d.first_run === true;
  } catch {
    isFirstRun.value = false;
    setupCheckError.value = '无法确认系统初始化状态，请重试后再注册。';
  }
}

async function boot() {
  checked.value = false;
  const ok = await loadConfig();
  if (ok) {
    const authed = await ensureAuth();
    if (authed) { router.push({ name: 'inbox' }); return; }
    await checkSetup();
  }
  checked.value = true;
  await refreshIcons();
}

function goInbox() {
  const redirect = route.query.redirect;
  router.push(redirect ? redirect : { name: 'inbox' });
}

async function doLogin() {
  loading.value = true; errorMessage.value = '';
  try {
    const res = await apiFetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm.value)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    token.value = data.token;
    currentUser.value = loginForm.value.username;
    isAdmin.value = data.role === 'admin';
    isAuthenticated.value = false;
    storeSet('cf_mail_token', data.token);
    storeSet('cf_mail_user', currentUser.value);
    // 登录后复用统一的 /api/me，避免路由守卫再次并行加载重复数据。
    if (!(await ensureAuth(true))) throw new Error('登录态校验失败');
    goInbox();
  } catch (err) { errorMessage.value = '登录失败: ' + err.message; }
  finally { loading.value = false; await refreshIcons(); }
}

async function doRegister() {
  loading.value = true; errorMessage.value = '';
  if (!checked.value || setupCheckError.value) {
    errorMessage.value = setupCheckError.value || '正在检查系统状态，请稍候';
    loading.value = false;
    return;
  }
  // 首次使用需要初始化密钥；普通注册需要邀请码。
  if (isFirstRun.value && !registerForm.value.setupToken.trim()) {
    errorMessage.value = '请输入初始化密钥';
    loading.value = false;
    return;
  }
  if (!isFirstRun.value && !registerForm.value.invite.trim()) {
    errorMessage.value = '注册需要邀请码';
    loading.value = false;
    return;
  }
  try {
    const setup = isFirstRun.value;
    const res = await apiFetch(setup ? '/api/admin/setup' : '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setup
        ? {
            username: registerForm.value.username,
            password: registerForm.value.password,
            setup_token: registerForm.value.setupToken,
          }
        : {
            username: registerForm.value.username,
            password: registerForm.value.password,
            invite: registerForm.value.invite,
          })
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      isFirstRun.value = false;
      showRegister.value = false;
      loginForm.value.username = registerForm.value.username;
      registerForm.value = { username: '', password: '', invite: '', setupToken: '' };
      errorMessage.value = setup ? '管理员初始化成功，请登录' : '注册成功，请用刚填的昵称登录';
    } else throw new Error(data.error || '注册失败');
  } catch (err) { errorMessage.value = '注册失败: ' + err.message; }
  finally { loading.value = false; }
}

function toggleRegister() {
  showRegister.value = !showRegister.value;
  errorMessage.value = '';
}

onMounted(boot);
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-app px-4">
    <!-- 配置错误 -->
    <div v-if="configError" class="max-w-md w-full bg-surface rounded-xl shadow-panel p-6 text-center space-y-4 border border-line">
      <div class="inline-flex p-3 bg-warn-soft text-warn rounded-full"><i data-lucide="alert-triangle" class="w-8 h-8"></i></div>
      <h3 class="text-lg font-bold text-main">配置需要检查</h3>
      <p class="text-sm text-sub">{{ configErrorMessage }}</p>
      <div class="text-xs bg-surface2 p-3 rounded-lg font-mono text-left text-sub border border-line">
        { "baseUrl": "https://mail-backend.your-domain.com", "defaultDomain": "your-domain.com" }
      </div>
      <button @click="boot" class="px-4 py-2 bg-accent text-accent-ink rounded-lg text-sm">重新检测</button>
    </div>

    <!-- 初始化检查中：避免检查完成前误显示邀请码表单 -->
    <div v-else-if="!checked" class="max-w-md w-full bg-surface rounded-xl shadow-panel p-8 text-center border border-line">
      <p class="text-sm text-sub">正在检查系统状态…</p>
    </div>

    <!-- 登录 / 注册 -->
    <div v-else class="max-w-md w-full bg-surface rounded-xl shadow-panel p-8 space-y-6 border border-line">
      <div class="text-center">
        <div class="inline-flex p-3 bg-accent-soft text-accent rounded-full mb-3"><i data-lucide="mail" class="w-8 h-8"></i></div>
        <h2 class="text-2xl font-bold text-main">{{ showRegister ? '注册' : '登录' }}</h2>
        <p class="text-xs text-sub font-mono mt-1">{{ baseUrl }}</p>
      </div>

      <div v-if="errorMessage" class="bg-danger-soft border border-danger-soft text-danger text-sm rounded-lg px-4 py-2">{{ errorMessage }}</div>
      <div v-if="setupCheckError && showRegister" class="bg-warn-soft border border-line text-warn text-sm rounded-lg px-4 py-2">
        {{ setupCheckError }}
        <button type="button" @click="boot" class="ml-1 underline">重新检查</button>
      </div>

      <form v-if="!showRegister" @submit.prevent="doLogin" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-sub mb-1">昵称</label>
          <input type="text" v-model="loginForm.username" required placeholder="请输入昵称" autocomplete="username"
            class="w-full px-3 py-2 bg-surface2 text-main border border-line rounded-lg focus:ring-2 ring-accent focus:outline-none text-sm">
        </div>
        <div>
          <label class="block text-sm font-medium text-sub mb-1">密码</label>
          <input type="password" v-model="loginForm.password" required placeholder="请输入密码" autocomplete="current-password"
            class="w-full px-3 py-2 bg-surface2 text-main border border-line rounded-lg focus:ring-2 ring-accent focus:outline-none text-sm">
        </div>
        <button type="submit" :disabled="loading"
          class="w-full py-2.5 bg-accent hover-bg-accent-h text-accent-ink font-medium rounded-lg shadow transition">
          {{ loading ? '处理中...' : '登录' }}
        </button>
      </form>

      <form v-else @submit.prevent="doRegister" class="space-y-4">
        <div v-if="isFirstRun" class="bg-accent-soft text-accent text-sm rounded-lg px-4 py-2">
          首次使用：使用初始化密钥创建系统管理员。
        </div>
        <div>
          <label class="block text-sm font-medium text-sub mb-1">昵称（登录账号）</label>
          <input type="text" v-model="registerForm.username" required maxlength="32" placeholder="英文/数字/._-，最长32"
            class="w-full px-3 py-2 bg-surface2 text-main border border-line rounded-lg focus:ring-2 ring-accent text-sm">
          <p class="text-xs text-faint mt-1">仅允许英文字母、数字、._-，一个昵称即一个账户</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-sub mb-1">密码（至少 6 位）</label>
          <input type="password" v-model="registerForm.password" required minlength="6" placeholder="输入密码"
            class="w-full px-3 py-2 bg-surface2 text-main border border-line rounded-lg focus:ring-2 ring-accent text-sm">
        </div>
        <div v-if="isFirstRun">
          <label class="block text-sm font-medium text-sub mb-1">初始化密钥</label>
          <input type="password" v-model="registerForm.setupToken" required autocomplete="off" placeholder="输入部署时设置的初始化密钥"
            class="w-full px-3 py-2 bg-surface2 text-main border border-line rounded-lg focus:ring-2 ring-accent text-sm">
          <p class="text-xs text-faint mt-1">初始化密钥由部署者在 Cloudflare Worker Secret 中设置。</p>
        </div>
        <div v-if="!isFirstRun">
          <label class="block text-sm font-medium text-sub mb-1">邀请码</label>
          <input type="text" v-model="registerForm.invite" required placeholder="输入管理员发放的邀请码"
            class="w-full px-3 py-2 bg-surface2 text-main border border-line rounded-lg focus:ring-2 ring-accent text-sm">
        </div>
        <button type="submit" :disabled="loading || !!setupCheckError" class="w-full py-2.5 bg-accent hover-bg-accent-h text-accent-ink font-medium rounded-lg shadow transition">
          {{ loading ? '处理中...' : '注册' }}
        </button>
      </form>

      <div class="text-center text-sm">
        <button v-if="!showRegister" @click="toggleRegister" class="text-accent hover:underline">没有账号？点击注册</button>
        <button v-else @click="toggleRegister" class="text-accent hover:underline">已有账号？点击登录</button>
      </div>

      <RouterLink to="/" class="block text-center text-xs text-faint hover:text-accent">← 返回首页</RouterLink>
    </div>
  </div>
</template>
