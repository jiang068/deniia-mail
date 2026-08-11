<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  currentUser, isAdmin, currentMailbox, fetchMailboxes,
  refreshIcons, theme, accent, ACCENT_PRESETS, setTheme, setAccent, clearAuth,
} from '../stores/mail.js';

const router = useRouter();

function doLogout() { clearAuth(); router.push({ name: 'login' }); }

onMounted(async () => {
  await fetchMailboxes();
  await refreshIcons();
});
</script>

<template>
  <main class="flex-1 p-4 md:p-10 overflow-y-auto h-full">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-8 flex-wrap gap-2">
        <h1 class="text-2xl font-bold text-main flex items-center space-x-2">
          <i data-lucide="palette" class="w-6 h-6 text-accent"></i>
          <span>外观设置</span>
        </h1>
        <RouterLink to="/inbox" class="text-sm text-accent hover:underline">← 返回收件箱</RouterLink>
      </div>

      <!-- 主题（日/夜） -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
        <h2 class="font-semibold text-main mb-1">主题模式</h2>
        <p class="text-xs text-sub mb-4">日间默认少女粉，夜间默认神秘紫，均可自定义强调色。</p>
        <div class="grid grid-cols-2 gap-4">
          <button @click="setTheme('light')"
            :class="['rounded-xl border-2 p-4 text-left transition', theme==='light' ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent']">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-100 to-pink-300 border border-pink-200"></div>
              <div>
                <p class="text-sm font-medium text-main">日间</p>
                <p class="text-xs text-sub">明亮 · 少女粉</p>
              </div>
              <i v-if="theme==='light'" data-lucide="check-circle-2" class="w-5 h-5 text-accent ml-auto"></i>
            </div>
          </button>
          <button @click="setTheme('dark')"
            :class="['rounded-xl border-2 p-4 text-left transition', theme==='dark' ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent']">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-800 to-purple-500 border border-violet-700"></div>
              <div>
                <p class="text-sm font-medium text-main">夜间</p>
                <p class="text-xs text-sub">深邃 · 神秘紫</p>
              </div>
              <i v-if="theme==='dark'" data-lucide="check-circle-2" class="w-5 h-5 text-accent ml-auto"></i>
            </div>
          </button>
        </div>
      </div>

      <!-- 强调色 -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
        <h2 class="font-semibold text-main mb-1">主题色（{{ theme === 'light' ? '日间' : '夜间' }}）</h2>
        <p class="text-xs text-sub mb-4">设置保存在本机浏览器中，不影响他人，也不入库。</p>
        <div class="flex flex-wrap gap-3">
          <button v-for="p in ACCENT_PRESETS" :key="p.hex"
            @click="setAccent(p.hex)"
            :class="['color-swatch', accent === p.hex ? 'active' : '']"
            :style="{ backgroundColor: p.hex }" :title="p.name"></button>
        </div>
        <div class="mt-4 flex items-center gap-3">
          <label class="text-xs text-faint">自定义颜色：</label>
          <input type="color" :value="accent" @input="setAccent($event.target.value)"
            class="w-10 h-9 rounded cursor-pointer border border-line">
          <span class="text-xs font-mono text-sub">{{ accent }}</span>
        </div>
        <div class="mt-6 p-4 rounded-lg border border-line bg-surface2">
          <p class="text-xs text-sub mb-3">预览：</p>
          <div class="flex flex-wrap items-center gap-3">
            <button class="px-3 py-1.5 bg-accent text-accent-ink rounded-lg text-xs">主要按钮</button>
            <span class="px-2 py-1 bg-accent-soft text-accent rounded text-xs">标签</span>
            <span class="text-accent text-sm">链接文字</span>
          </div>
        </div>
      </div>

      <div class="bg-surface shadow-panel border border-line rounded-xl p-6">
        <h2 class="font-semibold text-main mb-4">账号信息</h2>
        <div class="space-y-2 text-sm">
          <p class="text-sub">用户名：<span class="text-main font-mono">{{ currentUser }}</span></p>
          <p class="text-sub">当前邮箱：<span class="text-main font-mono">{{ currentMailbox }}</span></p>
          <p class="text-sub">角色：<span :class="isAdmin ? 'text-warn font-medium' : 'text-main'">{{ isAdmin ? '管理员' : '普通用户' }}</span></p>
        </div>
      </div>
    </div>
  </main>
</template>