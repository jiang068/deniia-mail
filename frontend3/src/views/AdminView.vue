<script setup>
import { ref, onMounted } from 'vue';
import {
  baseUrl, isAdmin, isAuthenticated, fetchMailboxes,
  refreshIcons, authHeaders, clearAuth,
} from '../stores/mail.js';
import { useRouter } from 'vue-router';

const router = useRouter();

const ready = ref(false);
const errorMessage = ref('');
const adminSettings = ref({ allow_registration: 'false', daily_send_limit: '50', default_mailbox_limit: '3' });
const adminUsers = ref([]);

async function loadAdmin() {
  try {
    const [settingsRes, usersRes] = await Promise.all([
      fetch(`${baseUrl.value}/api/admin/settings`, { headers: authHeaders() }),
      fetch(`${baseUrl.value}/api/admin/users`, { headers: authHeaders() })
    ]);
    const sData = await settingsRes.json();
    adminSettings.value = sData.settings || {};
    const uData = await usersRes.json();
    adminUsers.value = uData.users || [];
  } catch (e) { errorMessage.value = '加载管理面板失败: ' + e.message; }
  await refreshIcons();
}

async function toggleRegistration() {
  const newVal = adminSettings.value.allow_registration === 'true' ? 'false' : 'true';
  try {
    const res = await fetch(`${baseUrl.value}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ key: 'allow_registration', value: newVal })
    });
    const data = await res.json();
    if (data.ok) adminSettings.value.allow_registration = newVal;
  } catch (e) { errorMessage.value = '更新失败: ' + e.message; }
}

function updateSendLimit() {
  fetch(`${baseUrl.value}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ key: 'daily_send_limit', value: String(adminSettings.value.daily_send_limit) })
  }).then(r => r.json()).then(d => { if (!d.ok) errorMessage.value = '更新失败'; })
    .catch(e => errorMessage.value = '更新失败: ' + e.message);
}

function updateDefaultMailboxLimit() {
  fetch(`${baseUrl.value}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ key: 'default_mailbox_limit', value: String(adminSettings.value.default_mailbox_limit) })
  }).then(r => r.json()).then(d => { if (!d.ok) errorMessage.value = '更新失败'; })
    .catch(e => errorMessage.value = '更新失败: ' + e.message);
}

function doLogout() { clearAuth(); router.push({ name: 'login' }); }

onMounted(async () => {
  await fetchMailboxes();
  if (isAdmin.value) await loadAdmin();
  ready.value = true;
  await refreshIcons();
});
</script>

<template>
  <main class="flex-1 p-4 md:p-10 overflow-y-auto h-full">
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 class="text-xl font-bold text-main flex items-center space-x-2">
          <i data-lucide="shield" class="w-6 h-6 text-warn"></i>
          <span>管理后台</span>
        </h1>
        <div class="flex gap-3">
          <RouterLink to="/settings" class="text-sm text-accent hover:underline">设置</RouterLink>
          <RouterLink to="/inbox" class="text-sm text-accent hover:underline">← 返回收件箱</RouterLink>
        </div>
      </div>

      <div v-if="!ready" class="text-faint text-sm">加载中...</div>

      <div v-else-if="!isAdmin" class="bg-surface shadow-panel border border-line rounded-xl p-10 text-center">
        <i data-lucide="shield-x" class="w-10 h-10 text-faint mx-auto mb-3"></i>
        <p class="text-sub">您没有管理员权限。</p>
        <RouterLink to="/inbox" class="inline-block mt-4 px-4 py-2 bg-accent text-accent-ink rounded-lg text-sm">返回收件箱</RouterLink>
      </div>

      <div v-else>
        <div v-if="errorMessage" class="bg-danger-soft border border-danger-soft text-danger text-sm rounded-lg px-4 py-2 mb-4">{{ errorMessage }}</div>

        <!-- 系统设置 -->
        <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
          <h2 class="font-semibold text-main mb-4 flex items-center gap-2"><i data-lucide="settings" class="w-4 h-4 text-accent"></i>系统设置</h2>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-main">开放注册</p>
                <p class="text-xs text-sub">关闭后新用户无法自行注册</p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" class="sr-only peer"
                  :checked="adminSettings.allow_registration === 'true'"
                  @change="toggleRegistration">
                <div class="w-9 h-5 rounded-full transition peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"
                  :style="{ backgroundColor: adminSettings.allow_registration==='true' ? 'var(--c-accent)' : 'var(--c-border)' }"></div>
              </label>
            </div>
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-main">每日发件限额</p>
                <p class="text-xs text-sub">每位用户每天最多发送邮件数</p>
              </div>
              <div class="flex items-center space-x-2">
                <input type="number" v-model.number="adminSettings.daily_send_limit" min="1" max="10000"
                  class="w-20 bg-surface2 text-main border border-line rounded-lg px-2 py-1 text-sm text-center">
                <button @click="updateSendLimit" class="px-3 py-1 bg-accent text-accent-ink rounded-lg text-sm">保存</button>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-main">默认邮箱限额</p>
                <p class="text-xs text-sub">普通用户最多可创建的邮箱数（管理员不限）</p>
              </div>
              <div class="flex items-center space-x-2">
                <input type="number" v-model.number="adminSettings.default_mailbox_limit" min="1" max="100"
                  class="w-20 bg-surface2 text-main border border-line rounded-lg px-2 py-1 text-sm text-center">
                <button @click="updateDefaultMailboxLimit" class="px-3 py-1 bg-accent text-accent-ink rounded-lg text-sm">保存</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 用户列表 -->
        <div class="bg-surface shadow-panel border border-line rounded-xl p-6">
          <h2 class="font-semibold text-main mb-4 flex items-center gap-2"><i data-lucide="users" class="w-4 h-4 text-accent"></i>用户列表</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead>
                <tr class="border-b border-line text-xs text-faint">
                  <th class="p-2">用户名</th>
                  <th class="p-2">邮箱</th>
                  <th class="p-2">角色</th>
                  <th class="p-2">邮箱限额</th>
                  <th class="p-2">创建时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in adminUsers" :key="u.id" class="border-b border-line text-sm">
                  <td class="p-2 font-medium text-main">{{ u.username }}</td>
                  <td class="p-2 text-sub text-xs">{{ u.email_address }}</td>
                  <td class="p-2">
                    <span v-if="u.role === 'admin'" class="text-warn text-xs font-medium">Admin</span>
                    <span v-else class="text-faint text-xs">User</span>
                  </td>
                  <td class="p-2 text-xs text-sub">{{ u.role === 'admin' ? '不限' : (u.mailbox_limit || '—') }}</td>
                  <td class="p-2 text-xs text-faint">{{ u.created_at }}</td>
                </tr>
                <tr v-if="adminUsers.length === 0"><td colspan="5" class="p-4 text-center text-faint text-sm">暂无用户</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>