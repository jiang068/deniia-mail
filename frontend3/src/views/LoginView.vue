<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  baseUrl, token, currentUser, isAdmin, isAuthenticated,
  configError, configErrorMessage, loadConfig, ensureAuth,
  mailboxes, fetchMailboxes, fetchQuota, refreshIcons, setSelectedMailbox,
  storeGet, storeSet,
} from '../stores/mail.js';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const showRegister = ref(route.query.register === '1');
const errorMessage = ref('');
const loginForm = ref({ username: '', password: '' });
const registerForm = ref({ username: '', password: '', invite: '' });
const isFirstRun = ref(false);
const checked = ref(false);

async function checkSetup() {
  try {
    const res = await fetch(`${baseUrl.value}/api/admin/check`);
    const d = await res.json();
    isFirstRun.value = !d.admin_exists;
  } catch { isFirstRun.value = false; }
}

async function boot() {
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
    const res = await fetch(`${baseUrl.value}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm.value)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    token.value = data.token;
    currentUser.value = loginForm.value.username;
    isAdmin.value = data.role === 'admin';
    isAuthenticated.value = true;
    storeSet('cf_mail_token', data.token);
    storeSet('cf_mail_user', currentUser.value);
    await fetchMailboxes();
    await fetchQuota();
    if (mailboxes.value.length > 0 && !storeGet('cf_mail_selected')) {
      setSelectedMailbox(mailboxes.value[0].address);
    }
    goInbox();
  } catch (err) { errorMessage.value = '登录失败: ' + err.message; }
  finally { loading.value = false; await refreshIcons(); }
}

async function doRegister() {
  loading.value = true; errorMessage.value = '';
  if (!registerForm.value.invite.trim()) {
    errorMessage.value = '注册需要邀请码';
    loading.value = false;
    return;
  }
  try {
    const res = await fetch(`${baseUrl.value}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...registerForm.value })
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      showRegister.value = false;
      loginForm.value.username = registerForm.value.username;
      registerForm.value = { username: '', password: '', invite: '' };
      errorMessage.value = '注册成功，请用刚填的昵称登录';
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

    <!-- 登录 / 注册 -->
    <div v-else class="max-w-md w-full bg-surface rounded-xl shadow-panel p-8 space-y-6 border border-line">
      <div class="text-center">
        <div class="inline-flex p-3 bg-accent-soft text-accent rounded-full mb-3"><i data-lucide="mail" class="w-8 h-8"></i></div>
        <h2 class="text-2xl font-bold text-main">{{ showRegister ? '注册' : '登录' }}</h2>
        <p class="text-xs text-sub font-mono mt-1">{{ baseUrl }}</p>
      </div>

      <div v-if="errorMessage" class="bg-danger-soft border border-danger-soft text-danger text-sm rounded-lg px-4 py-2">{{ errorMessage }}</div>

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
          首次使用：注册的账号将作为系统管理员。
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
        <div>
          <label class="block text-sm font-medium text-sub mb-1">邀请码</label>
          <input type="text" v-model="registerForm.invite" required placeholder="输入管理员发放的邀请码"
            class="w-full px-3 py-2 bg-surface2 text-main border border-line rounded-lg focus:ring-2 ring-accent text-sm">
        </div>
        <button type="submit" :disabled="loading" class="w-full py-2.5 bg-accent hover-bg-accent-h text-accent-ink font-medium rounded-lg shadow transition">
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