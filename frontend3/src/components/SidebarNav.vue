<script setup>
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  isAdmin, isAuthenticated,
  mailboxes, selectedMailbox, quota, currentMailbox, navFolders,
  switchMailbox, fetchMailboxes, clearAuth,
} from '../stores/mail.js';
import { mobileSidebarCls, closeDrawer, isMobile, sidebarOpen } from '../composables/mobileShell.js';
import { openMailboxDialog } from '../composables/useMailboxDialog.js';
import MailboxDialog from './MailboxDialog.vue';

const route = useRoute();
const router = useRouter();

const isActive = (id) => route.name === id;

// 侧栏邮箱列在首挂时填充（各视图 onMounted 也会拉取，这里兜底）
onMounted(async () => {
  if (isAuthenticated.value) await fetchMailboxes();
});

function onSelectMailbox(addr) {
  closeDrawer();
  switchMailbox(addr);
  // 列表页会 watch selectedMailbox 自动刷新，无需强制导航
}

function doLogout() {
  clearAuth();
  router.push({ name: 'login' });
}
</script>

<template>
  <div>
    <aside :class="mobileSidebarCls">
      <div class="space-y-4">
        <div class="flex items-center justify-between px-2">
          <div class="flex items-center space-x-2">
            <i data-lucide="mail-check" class="w-6 h-6 text-accent"></i>
            <span class="text-lg font-bold text-main tracking-wide">Deniia Mail</span>
          </div>
          <RouterLink to="/settings" title="设置" class="text-faint hover:text-accent" @click="closeDrawer()"><i data-lucide="palette" class="w-5 h-5"></i></RouterLink>
        </div>

        <RouterLink v-for="folder in navFolders" :key="folder.id" :to="folder.path" @click="closeDrawer()"
          :class="['flex items-center justify-between px-3 py-2 rounded-lg text-sm transition',
            isActive(folder.id) ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-surface3 text-sub']">
          <div class="flex items-center space-x-3"><i :data-lucide="folder.icon" class="w-4 h-4"></i><span>{{ folder.label }}</span></div>
        </RouterLink>

        <RouterLink v-if="isAdmin" to="/admin" @click="closeDrawer()"
          class="w-full flex items-center space-x-3 px-3 py-2 text-sm text-warn hover:bg-surface3 rounded-lg">
          <i data-lucide="shield" class="w-4 h-4"></i><span>管理后台</span>
        </RouterLink>

        <RouterLink to="/settings" @click="closeDrawer()"
          :class="['w-full flex items-center space-x-3 px-3 py-2 text-sm rounded-lg',
            route.name === 'settings' ? 'bg-accent-soft text-accent font-medium' : 'text-sub hover:bg-surface3']">
          <i data-lucide="palette" class="w-4 h-4"></i><span>设置</span>
        </RouterLink>

        <div>
          <div class="flex items-center justify-between px-2 mb-1">
            <span class="text-xs text-faint font-medium">我的邮箱</span>
            <button @click="openMailboxDialog()" title="新建邮箱" class="text-faint hover:text-accent"><i data-lucide="plus-circle" class="w-4 h-4"></i></button>
          </div>
          <div class="space-y-0.5 max-h-40 overflow-y-auto">
            <div v-for="mb in mailboxes" :key="mb.id"
              @click="onSelectMailbox(mb.address)"
              :class="['px-3 py-1.5 rounded-lg cursor-pointer text-xs truncate transition', mb.address === selectedMailbox ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-surface3 text-sub']">
              <span v-if="mb.has_unread" class="inline-block w-1.5 h-1.5 bg-accent rounded-full mr-1.5"></span>
              {{ mb.address }}
            </div>
            <div v-if="mailboxes.length === 0" class="text-xs text-faint px-3 py-1">暂无邮箱</div>
          </div>
          <div class="px-2 pt-1 text-xs text-faint">已用 {{ quota.used }} / {{ isAdmin ? '∞' : quota.limit }} 个</div>
        </div>

        <RouterLink to="/compose" @click="closeDrawer()"
          class="w-full py-2.5 px-4 bg-accent hover-bg-accent-h text-accent-ink rounded-lg flex items-center justify-center space-x-2 font-medium shadow transition">
          <i data-lucide="square-pen" class="w-4 h-4"></i><span>撰写邮件</span>
        </RouterLink>
      </div>

      <div class="border-t pt-4 space-y-2 border-line">
        <div class="px-3 py-1 text-xs text-faint truncate">当前: <span class="text-accent font-mono">{{ currentMailbox || '未选择' }}</span></div>
        <button v-if="isAuthenticated" @click="doLogout" class="w-full flex items-center space-x-3 px-3 py-2 text-sm text-danger hover:bg-danger-soft rounded-lg">
          <i data-lucide="log-out" class="w-4 h-4"></i><span>退出登录</span>
        </button>
      </div>
    </aside>

    <!-- 移动端遮罩 -->
    <div v-if="isMobile && sidebarOpen" class="fixed inset-0 z-30" style="background:rgba(0,0,0,0.45); backdrop-filter:blur(2px);"
         @click="closeDrawer()"></div>

    <MailboxDialog />
  </div>
</template>