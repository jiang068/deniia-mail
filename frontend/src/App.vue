<script setup>
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import { loadingMessage, loadingVisible, refreshIcons } from './stores/mail.js';

const route = useRoute();

// 每次路由变化后重建 lucide 图标（覆盖 Home/Login 等无 ShellLayout 的页面）
watch(
  () => route.fullPath,
  async () => { await refreshIcons(); },
  { immediate: true }
);
</script>

<template>
  <router-view />
  <Transition name="loading-fade">
    <div v-if="loadingVisible" class="loading-overlay" role="status" aria-live="polite">
      <div class="loading-card">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span>{{ loadingMessage }}</span>
      </div>
    </div>
  </Transition>
</template>
