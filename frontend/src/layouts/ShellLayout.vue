<script setup>
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import SidebarNav from '../components/SidebarNav.vue';
import { isMobile, toggleDrawer } from '../composables/mobileShell.js';
import { brandName, refreshIcons } from '../stores/mail.js';

const route = useRoute();

// 路由切换后重建 lucide 图标（data-lucide 属性渲染）
watch(
  () => route.fullPath,
  async () => { await refreshIcons(); },
  { immediate: true }
);
</script>

<template>
  <div class="app-shell flex">
    <!-- 全局侧边栏：桌面常驻 / 移动端抽屉，路由切换零重绘 -->
    <SidebarNav />

    <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <!-- 移动端顶栏（仅手机显示）：汉堡 + 标题 -->
      <div v-if="isMobile" class="md:hidden flex items-center justify-between px-3 py-2 bg-surface border-b border-line shrink-0">
        <button @click="toggleDrawer()" class="p-1 text-main hover:text-accent" aria-label="菜单"><i data-lucide="menu" class="w-6 h-6"></i></button>
        <span class="text-base font-bold text-main tracking-wide flex items-center space-x-1.5"><i data-lucide="mail-check" class="w-5 h-5 text-accent"></i>{{ brandName }}</span>
        <span class="w-8"></span>
      </div>

      <!-- 动态主内容区 -->
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>
    </div>
  </div>
</template>

<style>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
