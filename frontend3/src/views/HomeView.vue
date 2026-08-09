<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  baseUrl, defaultDomain, currentUser, currentMailbox,
  configError, configErrorMessage, loadConfig, ensureAuth, refreshIcons,
} from '../stores/mail.js';

const router = useRouter();
const loggedIn = ref(false);

async function boot() {
  const ok = await loadConfig();
  if (ok) {
    const authed = await ensureAuth();
    loggedIn.value = authed;
  }
  await refreshIcons();
}

onMounted(boot);
</script>

<template>
  <!-- 配置错误 -->
  <div v-if="configError" class="min-h-screen flex items-center justify-center bg-app px-4">
    <div class="max-w-md w-full bg-surface rounded-xl shadow-panel p-6 text-center space-y-4 border border-line">
      <div class="inline-flex p-3 bg-warn-soft text-warn rounded-full"><i data-lucide="alert-triangle" class="w-8 h-8"></i></div>
      <h3 class="text-lg font-bold text-main">配置需要检查</h3>
      <p class="text-sm text-sub">{{ configErrorMessage }}</p>
      <div class="text-xs bg-surface2 p-3 rounded-lg font-mono text-left text-sub border border-line">
        { "baseUrl": "https://mail-backend.your-domain.com", "defaultDomain": "your-domain.com" }
      </div>
      <button @click="boot" class="px-4 py-2 bg-accent text-accent-ink rounded-lg text-sm">重新检测</button>
    </div>
  </div>

  <!-- 正常落地页 -->
  <div v-else class="min-h-screen flex flex-col">
    <div class="w-full flex items-center justify-between px-6 py-4">
      <div class="flex items-center space-x-2">
        <i data-lucide="mail-check" class="w-6 h-6 text-accent"></i>
        <span class="text-lg font-bold text-main tracking-wide">Deniia Mail</span>
      </div>
      <RouterLink to="/settings" title="设置" class="text-faint hover:text-accent"><i data-lucide="palette" class="w-5 h-5"></i></RouterLink>
    </div>

    <div class="flex-1 flex items-center justify-center px-6 pb-24">
      <div class="max-w-lg w-full text-center space-y-6">
        <div class="inline-flex p-5 bg-accent-soft text-accent rounded-3xl mb-2"><i data-lucide="mail" class="w-12 h-12"></i></div>
        <h1 class="text-3xl font-bold text-main">Deniia 临时邮箱</h1>
        <p class="text-sub leading-relaxed">隐私优先的临时邮箱。一次性的地址，拦截追踪器，保护你的收件箱不被骚扰。</p>

        <div v-if="loggedIn" class="space-y-4 pt-2">
          <div class="bg-surface border border-line rounded-xl p-5 text-left space-y-3">
            <p class="text-sm text-sub">已登录为
              <span class="text-main font-mono font-medium">{{ currentUser }}</span>
            </p>
            <p class="text-xs text-faint">当前邮箱：
              <span class="text-accent font-mono">{{ currentMailbox }}</span>
            </p>
          </div>
          <RouterLink to="/inbox" class="inline-block px-8 py-3 bg-accent hover-bg-accent-h text-accent-ink font-medium rounded-lg shadow transition">
            进入收件箱
          </RouterLink>
        </div>

        <div v-else class="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <RouterLink to="/login" class="px-8 py-3 bg-accent hover-bg-accent-h text-accent-ink font-medium rounded-lg shadow transition">登录</RouterLink>
          <RouterLink to="/login?register=1" class="px-8 py-3 bg-surface text-sub border border-line hover:bg-surface3 rounded-lg transition">注册</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>