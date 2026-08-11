<script setup>
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import { refreshIcons } from './stores/mail.js';

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
</template>