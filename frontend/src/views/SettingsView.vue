<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  currentUser, isAdmin, currentMailbox, fetchMailboxes,
  refreshIcons, theme, accent, ACCENT_PRESETS, setTheme, setAccent, clearAuth,
  themePacks, themePackId, setThemePack, brandName, brandTagline,
  backgroundImage, setBackgroundImage, clearBackgroundImage, backgroundOpacity, setBackgroundOpacity,
  uiOpacity, setUiOpacity,
  buttonOpacity, setButtonOpacity, buttonHoverOpacity, setButtonHoverOpacity,
} from '../stores/mail.js';

const router = useRouter();
const backgroundDraft = ref(/^https:\/\//i.test(backgroundImage.value) ? backgroundImage.value : '');
const backgroundError = ref('');
const backgroundPreviewStyle = computed(() => ({
  backgroundImage: backgroundImage.value ? `url("${backgroundImage.value}")` : 'none',
}));

function doLogout() { clearAuth(); router.push({ name: 'login' }); }

function saveBackground() {
  const before = backgroundDraft.value;
  setBackgroundImage(before);
  backgroundDraft.value = /^https:\/\//i.test(backgroundImage.value) ? backgroundImage.value : '';
  backgroundError.value = before.trim() && !backgroundImage.value
    ? '背景图必须使用 HTTPS 图片地址，或通过下方文件选择器上传。'
    : '';
}

function onBackgroundFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  backgroundError.value = '';
  if (!file) return;
  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) {
    backgroundError.value = '仅支持 PNG、JPEG、GIF 或 WebP 图片。';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    backgroundError.value = '本地背景图不能超过 2 MB。';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    setBackgroundImage(typeof reader.result === 'string' ? reader.result : '');
    // 不把数 MB 的 data URI 填入文本框，避免输入框和响应式状态承载大字符串。
    backgroundDraft.value = '';
  };
  reader.onerror = () => { backgroundError.value = '读取图片失败，请重试。'; };
  reader.readAsDataURL(file);
}

function removeBackground() {
  clearBackgroundImage();
  backgroundDraft.value = '';
  backgroundError.value = '';
}

onMounted(async () => {
  await fetchMailboxes();
  await refreshIcons();
});
</script>

<template>
  <main class="flex-1 min-h-0 p-4 md:p-10 overflow-y-auto h-full">
    <div class="max-w-2xl mx-auto">
      <div class="page-header">
        <RouterLink to="/inbox" class="back-link">← 返回收件箱</RouterLink>
        <h1 class="page-header-title text-2xl font-bold text-main">
          <i data-lucide="palette" class="w-6 h-6 text-accent"></i>
          <span>外观设置</span>
        </h1>
      </div>

      <!-- 主题包 -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
        <h2 class="font-semibold text-main mb-1">主题包</h2>
        <p class="text-xs text-sub mb-4">主题包按文件夹解耦，切换后品牌名称、配色和站点文案会一起变化。</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button v-for="pack in themePacks" :key="pack.id" @click="setThemePack(pack.id)"
            :class="['theme-pack-card', themePackId === pack.id ? 'active' : '']">
            <div class="theme-pack-preview" :style="{ background: `linear-gradient(135deg, ${pack.preview.light}, ${pack.preview.accent})` }">
              <span>{{ pack.brand.shortName }}</span>
            </div>
            <div class="flex items-start justify-between gap-3 mt-3">
              <div class="min-w-0 text-left">
                <p class="text-sm font-medium text-main truncate">{{ pack.name }}</p>
                <p class="text-xs text-sub mt-1">{{ pack.description }}</p>
              </div>
              <i v-if="themePackId === pack.id" data-lucide="check-circle-2" class="w-5 h-5 text-accent shrink-0"></i>
            </div>
          </button>
        </div>
        <p class="text-xs text-faint mt-4">当前站点：<span class="text-accent font-medium">{{ brandName }}</span> · {{ brandTagline }}</p>
      </div>

      <!-- 主题（日/夜） -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
        <h2 class="font-semibold text-main mb-1">主题模式</h2>
        <p class="text-xs text-sub mb-4">切换日间或夜间模式，强调色可以单独设置。</p>
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

      <!-- 背景图 -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
        <h2 class="font-semibold text-main mb-1">背景图</h2>
        <p class="text-xs text-sub mb-4">背景图只保存在当前浏览器。外链仅接受 HTTPS；也可以上传不超过 2 MB 的本地图片。</p>
        <div class="background-preview mb-4" :style="backgroundPreviewStyle">
          <div class="background-preview-label">{{ backgroundImage ? '背景预览' : '未设置背景图' }}</div>
        </div>
        <div class="flex flex-col sm:flex-row gap-2">
          <input v-model="backgroundDraft" type="url" placeholder="https://example.com/background.webp"
            class="flex-1 min-w-0 px-3 py-2 bg-surface2 text-main border border-line rounded-lg text-sm focus:ring-2 ring-accent focus:outline-none">
          <button @click="saveBackground" class="px-4 py-2 bg-accent text-accent-ink rounded-lg text-sm font-medium hover-bg-accent-h">应用</button>
          <button v-if="backgroundImage" @click="removeBackground" class="px-4 py-2 bg-surface2 text-sub border border-line rounded-lg text-sm font-medium hover:bg-surface3">清除</button>
        </div>
        <div class="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <label class="text-xs text-accent cursor-pointer hover:underline">
            <span>上传本地图片</span>
            <input type="file" class="sr-only" accept="image/png,image/jpeg,image/gif,image/webp" @change="onBackgroundFile">
          </label>
          <span class="text-xs text-faint">建议使用宽幅图片，界面会自动加遮罩保证文字可读。</span>
        </div>
        <div class="mt-4 p-3 rounded-lg border border-line bg-surface2">
          <div class="flex items-center justify-between gap-3 mb-2">
            <label for="background-opacity" class="text-xs font-medium text-main">背景遮罩透明度</label>
            <span class="text-xs text-accent font-mono">{{ Math.round(backgroundOpacity * 100) }}%</span>
          </div>
          <input id="background-opacity" type="range" min="0.1" max="0.8" step="0.05"
            :value="backgroundOpacity" @input="setBackgroundOpacity(Number($event.target.value))"
            class="background-opacity-range">
          <p class="text-[10px] text-faint mt-1">数值越低背景越清晰；数值越高文字对比度越强。</p>
        </div>
        <p v-if="backgroundError" class="text-xs text-danger mt-2">{{ backgroundError }}</p>
      </div>

      <!-- 界面元素透明度 -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
        <h2 class="font-semibold text-main mb-1">界面元素透明度</h2>
        <p class="text-xs text-sub mb-4">控制模块卡片、输入框和其他非按钮界面背景的实心程度。</p>
        <div class="flex items-center justify-between gap-3 mb-2">
          <label for="ui-opacity" class="text-xs font-medium text-main">元素透明度</label>
          <span class="text-xs text-accent font-mono">{{ Math.round(uiOpacity * 100) }}%</span>
        </div>
        <input id="ui-opacity" type="range" min="0.45" max="1" step="0.05"
          :value="uiOpacity" @input="setUiOpacity(Number($event.target.value))"
          class="background-opacity-range">
        <p class="text-[10px] text-faint mt-1">数值越低越通透；数值越高越接近实心。建议保持在 70% 以上。</p>
      </div>

      <!-- 按钮透明度 -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
        <h2 class="font-semibold text-main mb-1">按钮透明度</h2>
        <p class="text-xs text-sub mb-4">单独控制按钮未悬浮时的背景，不影响模块卡片与内容背景。</p>
        <div class="flex items-center justify-between gap-3 mb-2">
          <label for="button-opacity" class="text-xs font-medium text-main">按钮常态</label>
          <span class="text-xs text-accent font-mono">{{ Math.round(buttonOpacity * 100) }}%</span>
        </div>
        <input id="button-opacity" type="range" min="0.35" max="1" step="0.05"
          :value="buttonOpacity" @input="setButtonOpacity(Number($event.target.value))"
          class="background-opacity-range">
        <p class="text-[10px] text-faint mt-1">数值越低越通透；数值越高越接近实心。</p>
      </div>

      <!-- 按钮悬浮透明度 -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
        <h2 class="font-semibold text-main mb-1">按钮悬浮透明度</h2>
        <p class="text-xs text-sub mb-4">控制鼠标移入收件箱、发件箱及其他操作按钮时的背景透明度。</p>
        <div class="flex items-center justify-between gap-3 mb-2">
          <label for="button-hover-opacity" class="text-xs font-medium text-main">按钮悬浮态</label>
          <span class="text-xs text-accent font-mono">{{ Math.round(buttonHoverOpacity * 100) }}%</span>
        </div>
        <input id="button-hover-opacity" type="range" min="0.35" max="1" step="0.05"
          :value="buttonHoverOpacity" @input="setButtonHoverOpacity($event.target.valueAsNumber)"
          class="background-opacity-range">
        <p class="text-[10px] text-faint mt-1">只影响鼠标悬浮背景；数值越低越通透，越高越接近实心。</p>
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
