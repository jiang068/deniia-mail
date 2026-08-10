<script setup>
import { ref, watch, onMounted } from 'vue';
import {
  baseUrl, isAdmin, fetchMailboxes,
  refreshIcons, authHeaders,
} from '../stores/mail.js';

const ready = ref(false);
const errorMessage = ref('');
const activeTab = ref('settings'); // settings | users | invites | stats | mailboxes

const adminSettings = ref({ allow_registration: 'false', daily_send_limit: '50', default_mailbox_limit: '3', site_daily_limit: '100' });
const adminUsers = ref([]);

// 全站发件统计
const siteStats = ref({ days: [], today: 0, limit: 100 });

async function loadSiteStats() {
  try {
    const res = await fetch(`${baseUrl.value}/api/admin/sent/daily?days=30`, { headers: authHeaders() });
    const data = await res.json();
    siteStats.value = { days: data.days || [], today: data.today || 0, limit: data.limit || 100 };
  } catch (e) { errorMessage.value = '加载发件统计失败: ' + e.message; }
}

// 邀请码
const invites = ref([]);
const inviteCount = ref(5);
const inviteUses = ref(1);
const generating = ref(false);

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

async function loadInvites() {
  try {
    const res = await fetch(`${baseUrl.value}/api/admin/invites`, { headers: authHeaders() });
    const data = await res.json();
    invites.value = data.invites || [];
  } catch (e) { errorMessage.value = '加载邀请码失败: ' + e.message; }
}

async function generateInvites() {
  generating.value = true; errorMessage.value = '';
  try {
    const res = await fetch(`${baseUrl.value}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ count: inviteCount.value, uses: inviteUses.value })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '生成失败');
    await loadInvites();
  } catch (e) { errorMessage.value = '生成失败: ' + e.message; }
  finally { generating.value = false; }
}

async function revokeInvite(id) {
  if (!confirm('确定吊销该邀请码？')) return;
  try {
    await fetch(`${baseUrl.value}/api/admin/invites/${id}`, { method: 'DELETE', headers: authHeaders() });
    await loadInvites();
  } catch (e) { errorMessage.value = '吊销失败: ' + e.message; }
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

function updateSetting(key) {
  fetch(`${baseUrl.value}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ key, value: String(adminSettings.value[key]) })
  }).then(r => r.json()).then(d => { if (!d.ok) errorMessage.value = '更新失败'; })
    .catch(e => errorMessage.value = '更新失败: ' + e.message);
}

// 精确调整某用户的邮箱配额
async function updateUserQuota(user) {
  const limit = parseInt(user.mailbox_limit_input, 10) || user.mailbox_limit;
  try {
    const res = await fetch(`${baseUrl.value}/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ mailbox_limit: limit })
    });
    const data = await res.json();
    if (data.ok) {
      user.mailbox_limit = limit;
      user.mailbox_limit_input = limit;
    } else throw new Error(data.error || '更新失败');
  } catch (e) { errorMessage.value = '更新配额失败: ' + e.message; }
}

// 打开「邀请码/发件统计」页签时按需加载
watch(activeTab, async (t) => {
  if (t === 'invites') await loadInvites();
  if (t === 'stats') await loadSiteStats();
});

onMounted(async () => {
  await fetchMailboxes();
  if (isAdmin.value) await loadAdmin();
  ready.value = true;
  await refreshIcons();
});
</script>

<template>
  <main class="flex-1 p-4 md:p-8 overflow-y-auto h-full">
    <div class="max-w-6xl mx-auto">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 class="text-xl font-bold text-main flex items-center space-x-2">
          <i data-lucide="shield" class="w-6 h-6 text-warn"></i>
          <span>管理后台</span>
        </h1>
        <RouterLink to="/inbox" class="text-sm text-accent hover:underline">← 返回收件箱</RouterLink>
      </div>

      <div v-if="!ready" class="text-faint text-sm">加载中...</div>

      <div v-else-if="!isAdmin" class="bg-surface shadow-panel border border-line rounded-xl p-10 text-center">
        <i data-lucide="shield-x" class="w-10 h-10 text-faint mx-auto mb-3"></i>
        <p class="text-sub">您没有管理员权限。</p>
        <RouterLink to="/inbox" class="inline-block mt-4 px-4 py-2 bg-accent text-accent-ink rounded-lg text-sm">返回收件箱</RouterLink>
      </div>

      <template v-else>
        <div v-if="errorMessage" class="bg-danger-soft border border-danger-soft text-danger text-sm rounded-lg px-4 py-2 mb-4">{{ errorMessage }}</div>

        <!-- Tab 导航 -->
        <div class="flex gap-2 mb-6 flex-wrap bg-surface2 p-1 rounded-lg w-fit">
          <button @click="activeTab='settings'"
            :class="['px-4 py-1.5 rounded-md text-sm font-medium', activeTab==='settings' ? 'bg-accent text-accent-ink shadow' : 'text-sub hover:bg-surface3']">系统设置</button>
          <button @click="activeTab='users'"
            :class="['px-4 py-1.5 rounded-md text-sm font-medium', activeTab==='users' ? 'bg-accent text-accent-ink shadow' : 'text-sub hover:bg-surface3']">用户管理</button>
          <button @click="activeTab='invites'"
            :class="['px-4 py-1.5 rounded-md text-sm font-medium', activeTab==='invites' ? 'bg-accent text-accent-ink shadow' : 'text-sub hover:bg-surface3']">邀请码</button>
          <button @click="activeTab='stats'"
            :class="['px-4 py-1.5 rounded-md text-sm font-medium', activeTab==='stats' ? 'bg-accent text-accent-ink shadow' : 'text-sub hover:bg-surface3']">发件统计</button>
          <RouterLink to="/admin/mailboxes"
            class="px-4 py-1.5 rounded-md text-sm font-medium text-sub hover:bg-surface3">邮箱/邮件 ▸</RouterLink>
        </div>

        <!-- 系统设置 -->
        <div v-if="activeTab==='settings'" class="bg-surface shadow-panel border border-line rounded-xl p-6">
          <h2 class="font-semibold text-main mb-4 flex items-center gap-2"><i data-lucide="settings" class="w-4 h-4 text-accent"></i>系统设置</h2>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-main">开放注册（凭邀请码）</p>
                <p class="text-xs text-sub">开启后新用户需凭有效邀请码才能注册</p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" class="sr-only peer"
                  :checked="adminSettings.allow_registration === 'true'"
                  @change="toggleRegistration">
                <div class="w-9 h-5 rounded-full transition"
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
                <button @click="updateSetting('daily_send_limit')" class="px-3 py-1 bg-accent text-accent-ink rounded-lg text-sm">保存</button>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-main">站点每日限额</p>
                <p class="text-xs text-sub">全站每天最多发件数（对照 Resend 每日配额）</p>
              </div>
              <div class="flex items-center space-x-2">
                <input type="number" v-model.number="adminSettings.site_daily_limit" min="1" max="1000000"
                  class="w-24 bg-surface2 text-main border border-line rounded-lg px-2 py-1 text-sm text-center">
                <button @click="updateSetting('site_daily_limit')" class="px-3 py-1 bg-accent text-accent-ink rounded-lg text-sm">保存</button>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-main">默认邮箱限额</p>
                <p class="text-xs text-sub">新用户默认最多可创建的邮箱数</p>
              </div>
              <div class="flex items-center space-x-2">
                <input type="number" v-model.number="adminSettings.default_mailbox_limit" min="1" max="100"
                  class="w-20 bg-surface2 text-main border border-line rounded-lg px-2 py-1 text-sm text-center">
                <button @click="updateSetting('default_mailbox_limit')" class="px-3 py-1 bg-accent text-accent-ink rounded-lg text-sm">保存</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 用户管理 -->
        <div v-else-if="activeTab==='users'" class="bg-surface shadow-panel border border-line rounded-xl p-6">
          <h2 class="font-semibold text-main mb-4 flex items-center gap-2"><i data-lucide="users" class="w-4 h-4 text-accent"></i>用户管理</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead>
                <tr class="border-b border-line text-xs text-faint">
                  <th class="p-2">昵称</th>
                  <th class="p-2">邮箱（可创建数量）</th>
                  <th class="p-2">角色</th>
                  <th class="p-2">邮箱配额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in adminUsers" :key="u.id" class="border-b border-line text-sm align-top">
                  <td class="p-2 font-medium text-main">{{ u.username }}</td>
                  <td class="p-2 text-sub text-xs">
                    <div v-if="u.mailboxes && u.mailboxes.length">{{ u.mailboxes.join(', ') }}</div>
                    <div v-else class="text-faint">（无邮箱）</div>
                  </td>
                  <td class="p-2">
                    <span v-if="u.role === 'admin'" class="text-warn text-xs font-medium">Admin</span>
                    <span v-else class="text-faint text-xs">User</span>
                  </td>
                  <td class="p-2">
                    <div class="flex items-center space-x-2">
                      <input type="number" min="0" :value="u.mailbox_limit"
                        @input="u.mailbox_limit_input = $event.target.value"
                        class="w-20 bg-surface2 text-main border border-line rounded-lg px-2 py-1 text-xs text-center">
                      <button @click="updateUserQuota(u)" class="px-2.5 py-1 bg-accent text-accent-ink rounded-md text-xs">保存</button>
                    </div>
                    <span class="text-xs text-faint">当前 {{ u.mailbox_count }} 个邮箱</span>
                  </td>
                </tr>
                <tr v-if="adminUsers.length === 0"><td colspan="4" class="p-4 text-center text-faint text-sm">暂无用户</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 邀请码 -->
        <div v-else-if="activeTab==='invites'" class="space-y-6">
          <div class="bg-surface shadow-panel border border-line rounded-xl p-6">
            <h2 class="font-semibold text-main mb-4 flex items-center gap-2"><i data-lucide="gift" class="w-4 h-4 text-accent"></i>生成邀请码</h2>
            <div class="flex flex-wrap items-end gap-4">
              <div>
                <label class="block text-xs text-sub font-medium mb-1">数量</label>
                <input type="number" v-model.number="inviteCount" min="1" max="100"
                  class="w-24 bg-surface2 text-main border border-line rounded-lg px-2 py-1 text-sm">
              </div>
              <div>
                <label class="block text-xs text-sub font-medium mb-1">每个码可用次数</label>
                <input type="number" v-model.number="inviteUses" min="1" max="1000"
                  class="w-24 bg-surface2 text-main border border-line rounded-lg px-2 py-1 text-sm">
              </div>
              <button @click="generateInvites" :disabled="generating"
                class="px-4 py-1.5 bg-accent hover-bg-accent-h text-accent-ink rounded-lg text-sm font-medium">
                {{ generating ? '生成中...' : '生成' }}
              </button>
            </div>
          </div>

          <div class="bg-surface shadow-panel border border-line rounded-xl p-6">
            <h2 class="font-semibold text-main mb-4 flex items-center gap-2"><i data-lucide="list" class="w-4 h-4 text-accent"></i>邀请码列表</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-left">
                <thead>
                  <tr class="border-b border-line text-xs text-faint">
                    <th class="p-2">邀请码</th>
                    <th class="p-2">次数</th>
                    <th class="p-2">已用</th>
                    <th class="p-2">创建时间</th>
                    <th class="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="iv in invites" :key="iv.id" class="border-b border-line text-sm">
                    <td class="p-2 font-mono text-main">{{ iv.code }}</td>
                    <td class="p-2 text-sub">{{ iv.max_uses }}</td>
                    <td class="p-2">
                      <span :class="iv.used_count >= iv.max_uses ? 'text-faint' : 'text-green'">{{ iv.used_count }}</span>
                    </td>
                    <td class="p-2 text-xs text-faint">{{ iv.created_at }}</td>
                    <td class="p-2 text-right">
                      <button @click="revokeInvite(iv.id)" class="px-2.5 py-1 text-danger hover:bg-danger-soft rounded-md text-xs">吊销</button>
                    </td>
                  </tr>
                  <tr v-if="invites.length === 0"><td colspan="5" class="p-4 text-center text-faint text-sm">暂无邀请码</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 发件统计 -->
        <div v-else-if="activeTab==='stats'" class="space-y-6">
          <div class="bg-surface shadow-panel border border-line rounded-xl p-6">
            <h2 class="font-semibold text-main mb-4 flex items-center gap-2"><i data-lucide="bar-chart-3" class="w-4 h-4 text-accent"></i>全站今日发件（Resend 每日限额）</h2>
            <div class="flex items-center gap-4 flex-wrap">
              <div class="text-3xl font-bold text-main">{{ siteStats.today }}</div>
              <div class="text-sub text-sm">/ {{ siteStats.limit }} 封（今日剩余 {{ Math.max(siteStats.limit - siteStats.today, 0) }}）</div>
              <div class="flex-1 min-w-[160px] h-3 rounded-full bg-surface2 overflow-hidden">
                <div class="h-full transition-all"
                  :style="{ width: Math.min((siteStats.today / (siteStats.limit || 1)) * 100, 100) + '%', backgroundColor: siteStats.today >= siteStats.limit ? 'var(--c-danger)' : (siteStats.today >= siteStats.limit * 0.8 ? 'var(--c-warn)' : 'var(--c-accent)') }"></div>
              </div>
            </div>
            <p class="text-xs text-sub mt-3">Resend 免费档每日限额为 100 封（3000 封/月）。可在「系统设置」里调整 <code class="text-accent">站点每日限额</code>。</p>
          </div>

          <div class="bg-surface shadow-panel border border-line rounded-xl p-6">
            <h2 class="font-semibold text-main mb-4 flex items-center gap-2"><i data-lucide="calendar" class="w-4 h-4 text-accent"></i>最近 30 天全站发件量</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-left">
                <thead>
                  <tr class="border-b border-line text-xs text-faint">
                    <th class="p-2">日期</th>
                    <th class="p-2">发件数</th>
                    <th class="p-2 w-1/2">占比</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="d in siteStats.days" :key="d.day" class="border-b border-line text-sm">
                    <td class="p-2 text-main whitespace-nowrap">{{ d.day }}</td>
                    <td class="p-2 font-medium" :class="d.cnt >= siteStats.limit ? 'text-danger' : 'text-sub'">{{ d.cnt }}</td>
                    <td class="p-2">
                      <div class="h-2 rounded-full bg-surface2 overflow-hidden">
                        <div class="h-full" :style="{ width: Math.min((d.cnt / (siteStats.limit || 1)) * 100, 100) + '%', backgroundColor: d.cnt >= siteStats.limit ? 'var(--c-danger)' : 'var(--c-accent)' }"></div>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="siteStats.days.length === 0"><td colspan="3" class="p-4 text-center text-faint text-sm">暂无发件记录</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </template>
    </div>
  </main>
</template>