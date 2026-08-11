<script setup>
import { ref, computed, onMounted } from 'vue';
import {
  baseUrl, token, defaultDomain, isAdmin,
  mailboxes, quota, selectedMailbox, currentMailbox,
  fetchMailboxes, fetchQuota, refreshIcons, setSelectedMailbox,
} from '../stores/mail.js';

const errorMessage = ref('');
const notice = ref('');
const creating = ref(false);
const customName = ref('');

const quotaText = computed(() =>
  isAdmin.value ? '不限' : `${quota.value.used} / ${quota.value.limit}`
);
const atLimit = computed(() => !isAdmin.value && (quota.value.remaining ?? 0) <= 0);

function showError(msg) { notice.value = ''; errorMessage.value = msg; }
function showNotice(msg) { errorMessage.value = ''; notice.value = msg; }

async function refresh() {
  await fetchMailboxes(true);
  await fetchQuota(true);
  await refreshIcons();
}

async function createRandom() {
  if (atLimit.value) { showError(`邮箱数量已达上限（${quota.value.limit} 个）`); return; }
  creating.value = true; showError('');
  try {
    const res = await fetch(`${baseUrl.value}/api/generate`, { headers: { Authorization: `Bearer ${token.value}` } });
    const data = await res.json().catch(() => ({}));
    if (data.email) { setSelectedMailbox(data.email); showNotice(`已创建邮箱 ${data.email}`); await refresh(); }
    else showError(data.error || '生成失败');
  } catch (e) { showError('生成失败: ' + e.message); }
  finally { creating.value = false; }
}

async function createCustom() {
  const name = customName.value.trim().toLowerCase();
  if (atLimit.value) { showError(`邮箱数量已达上限（${quota.value.limit} 个）`); return; }
  if (!name || !/^[a-z0-9._-]{1,64}$/.test(name)) {
    showError('名称只能包含小写字母、数字、.-_（最长 64 位）');
    return;
  }
  creating.value = true; showError('');
  try {
    const res = await fetch(`${baseUrl.value}/api/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ local: name }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.email) { customName.value = ''; showNotice(`已创建邮箱 ${data.email}`); setSelectedMailbox(data.email); await refresh(); }
    else showError(data.error || '创建失败');
  } catch (e) { showError('创建失败: ' + e.message); }
  finally { creating.value = false; }
}

async function removeMailbox(mb) {
  if (!confirm(`确定要删除邮箱 ${mb.address} 吗？该邮箱下的所有邮件将一并删除，且无法恢复。`)) return;
  showError('');
  try {
    const res = await fetch(`${baseUrl.value}/api/mailbox/${mb.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token.value}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.ok) { showError(data.error || '删除失败'); return; }
    if (selectedMailbox.value === mb.address) {
      const rest = mailboxes.value.filter(m => m.id !== mb.id);
      setSelectedMailbox(rest[0]?.address || '');
    }
    showNotice(`已删除邮箱 ${mb.address}`);
    await refresh();
  } catch (e) { showError('删除失败: ' + e.message); }
}

onMounted(refresh);
</script>

<template>
  <main class="flex-1 p-4 md:p-10 overflow-y-auto h-full">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-8 flex-wrap gap-2">
        <h1 class="text-2xl font-bold text-main flex items-center space-x-2">
          <i data-lucide="mail" class="w-6 h-6 text-accent"></i>
          <span>邮箱管理</span>
        </h1>
        <RouterLink to="/inbox" class="text-sm text-accent hover:underline">← 返回收件箱</RouterLink>
      </div>

      <div v-if="errorMessage" class="bg-danger-soft border border-danger-soft text-danger text-sm rounded-lg px-4 py-2 mb-4">{{ errorMessage }}</div>
      <div v-if="notice" class="bg-green-soft border border-green-soft text-green text-sm rounded-lg px-4 py-2 mb-4">{{ notice }}</div>

      <!-- 配额 -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-semibold text-main">已用配额</h2>
            <p class="text-xs text-sub mt-1">共 {{ quotaText }} 个邮箱{{ atLimit ? '，已达上限，无法继续申请' : '' }}</p>
          </div>
          <div class="text-3xl font-bold text-main">{{ quotaText }}</div>
        </div>
        <div class="mt-3 h-2 rounded-full bg-surface2 overflow-hidden">
          <div class="h-full" :style="{ width: isAdmin ? 0 : Math.min((quota.used / (quota.limit || 1)) * 100, 100) + '%', backgroundColor: atLimit ? 'var(--c-warn)' : 'var(--c-accent)' }"></div>
        </div>
      </div>

      <!-- 申请新邮箱 -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6 mb-6">
        <h2 class="font-semibold text-main mb-3 flex items-center gap-2"><i data-lucide="square-plus" class="w-4 h-4 text-accent"></i>申请新邮箱</h2>
        <button @click="createRandom" :disabled="creating || atLimit"
          class="w-full text-left p-4 border border-line rounded-xl hover:border-accent hover:bg-accent-soft transition flex items-center space-x-3 mb-3 disabled:opacity-50">
          <div class="p-2 bg-accent-soft text-accent rounded-lg"><i data-lucide="shuffle" class="w-5 h-5"></i></div>
          <div>
            <p class="text-sm font-medium text-main">随机生成</p>
            <p class="text-xs text-sub">例如 3f9k2a@{{ defaultDomain }}，仅需一秒</p>
          </div>
        </button>
        <div class="border border-line rounded-xl p-4 space-y-2">
          <p class="text-sm font-medium text-main">自定义名称</p>
          <div class="flex items-center space-x-2">
            <input type="text" v-model="customName" placeholder="名称"
              class="flex-1 bg-surface2 text-main border border-line rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 ring-accent focus:outline-none">
            <span class="text-sm text-faint font-mono">@{{ defaultDomain }}</span>
          </div>
          <button @click="createCustom" :disabled="creating || atLimit"
            class="w-full py-2 bg-accent hover-bg-accent-h text-accent-ink rounded-lg text-sm font-medium disabled:opacity-50">
            {{ creating ? '处理中...' : '创建' }}
          </button>
        </div>
        <p v-if="atLimit" class="text-xs text-danger mt-3">已达到邮箱数量上限，无法申请新邮箱。如需更多，请联系管理员。</p>
      </div>

      <!-- 我的邮箱 -->
      <div class="bg-surface shadow-panel border border-line rounded-xl p-6">
        <h2 class="font-semibold text-main mb-3 flex items-center gap-2"><i data-lucide="mail" class="w-4 h-4 text-accent"></i>我的邮箱（{{ mailboxes.length }}）</h2>
        <div class="space-y-2">
          <div v-for="mb in mailboxes" :key="mb.id"
            class="flex items-center justify-between gap-2 px-4 py-3 border border-line rounded-lg">
            <div class="flex items-center space-x-2 min-w-0">
              <i data-lucide="mail" class="w-4 h-4 shrink-0 text-faint"></i>
              <span class="text-sm text-main truncate font-mono" :title="mb.address">{{ mb.address }}</span>
              <span v-if="mb.address === currentMailbox" class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">当前</span>
            </div>
            <button @click="removeMailbox(mb)"
              class="shrink-0 px-2.5 py-1 text-xs text-danger hover:bg-danger-soft rounded-md">删除</button>
          </div>
          <div v-if="mailboxes.length === 0" class="text-sm text-faint text-center py-6">你还没有邮箱，请先在上方申请一个。</div>
        </div>
      </div>
    </div>
  </main>
</template>