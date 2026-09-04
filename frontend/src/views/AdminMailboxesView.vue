<script setup>
import { ref, computed } from 'vue';
import {
  isAdmin, apiFetch,
  formatDate, buildEmailDocument, remoteContentLevel,
} from '../stores/mail.js';
import { isMobile } from '../composables/mobileShell.js';
import EmailFrame from '../components/EmailFrame.vue';

const loadingMailboxes = ref(false);
const loadingEmails = ref(false);
const loadingDetail = ref(false);
const errorMessage = ref('');

const tab = ref('inbox'); // inbox | sent

// 收件箱模式数据
const mailboxes = ref([]);
const emails = ref([]);
const selectedMailbox = ref(null);
// 发件箱模式数据
const sentEmails = ref([]);

const selectedEmail = ref(null);
const viewMode = ref('rendered'); // rendered | html | raw
const loadingRaw = ref(false);

const DELIVERY_LABELS = {
  sending: '发送中', sent: '已发送', delivered: '已送达',
  bounced: '已退回', complained: '被举报', delayed: '投递延迟',
  opened: '已读',
};
function deliveryText(s) { return DELIVERY_LABELS[s] || (s || '—'); }

const protectedContent = computed(() => {
  remoteContentLevel.value;
  const raw = selectedEmail.value?.html || selectedEmail.value?.text || '';
  return buildEmailDocument(raw);
});

// 移动端：三级下钻（仅收件箱模式有邮箱层级）
const leftCls = computed(() => {
  if (tab.value === 'sent') return 'hidden';
  if (selectedMailbox.value && isMobile.value) return 'hidden';
  if (isMobile.value && selectedEmail.value) return 'hidden';
  return 'w-72 md:w-80 min-h-0 bg-surface border-r border-line flex flex-col flex-shrink-0';
});
const midCls = computed(() => {
  if (tab.value === 'sent') {
    if (isMobile.value && selectedEmail.value) return 'hidden';
    return 'flex-1 min-h-0 bg-surface border-r border-line flex flex-col min-w-0';
  }
  if (!selectedMailbox.value) return 'hidden';
  if (isMobile.value && selectedEmail.value) return 'hidden';
  return 'flex-1 min-h-0 bg-surface border-r border-line flex flex-col min-w-0';
});
const detailCls = computed(() => {
  if (!selectedEmail.value) return 'hidden';
  return 'flex-1 min-h-0 bg-surface flex flex-col overflow-hidden';
});

function resetSelection() {
  selectedEmail.value = null;
  viewMode.value = 'rendered';
}

async function setViewMode(mode) {
  viewMode.value = mode;
  if (mode !== 'raw' || tab.value !== 'inbox' || !selectedEmail.value || selectedEmail.value.raw_content !== undefined || loadingRaw.value) return;
  loadingRaw.value = true;
  try {
    const res = await apiFetch(`/api/admin/email/${selectedEmail.value.id}?raw=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    selectedEmail.value = { ...selectedEmail.value, ...(data.email || {}) };
  } catch (e) { errorMessage.value = '加载原始邮件失败: ' + e.message; }
  finally { loadingRaw.value = false; }
}

async function switchTab(t) {
  resetSelection();
  tab.value = t;
  if (t === 'inbox') {
    if (mailboxes.value.length === 0) await loadMailboxes();
  } else {
    if (sentEmails.value.length === 0) await loadSent();
  }
}

async function loadMailboxes() {
  loadingMailboxes.value = true;
  try {
    const res = await apiFetch('/api/admin/mailboxes');
    const data = await res.json();
    mailboxes.value = data.mailboxes || [];
  } catch (e) { errorMessage.value = '加载邮箱失败: ' + e.message; }
  finally { loadingMailboxes.value = false; }
}

async function loadSent() {
  loadingEmails.value = true;
  try {
    const res = await apiFetch('/api/admin/sent');
    const data = await res.json();
    sentEmails.value = data.sent || [];
  } catch (e) { errorMessage.value = '加载发件箱失败: ' + e.message; }
  finally { loadingEmails.value = false; }
}

async function openMailbox(mb) {
  selectedMailbox.value = mb;
  resetSelection();
  loadingEmails.value = true;
  try {
    const res = await apiFetch(`/api/admin/mailboxes/${mb.id}/emails`);
    const data = await res.json();
    emails.value = data.emails || [];
  } catch (e) { errorMessage.value = '加载邮件失败: ' + e.message; emails.value = []; }
  finally { loadingEmails.value = false; }
}

async function openEmail(mail) {
  selectedEmail.value = { ...mail };
  viewMode.value = 'rendered';
  loadingDetail.value = true;
  try {
    const res = await apiFetch(`/api/admin/email/${mail.id}`);
    if (res.ok) {
      const data = await res.json();
      selectedEmail.value = { ...mail, ...(data.email || {}) };
    } else {
      const data = await res.json().catch(() => ({}));
      errorMessage.value = data.error || '加载邮件详情失败';
    }
  } catch (e) { errorMessage.value = '加载详情失败: ' + e.message; }
  finally { loadingDetail.value = false; }
}

async function openSentEmail(sent) {
  selectedEmail.value = { ...sent };
  viewMode.value = 'rendered';
  loadingDetail.value = true;
  try {
    const res = await apiFetch(`/api/admin/sent/${sent.id}`);
    if (res.ok) {
      const data = await res.json();
      selectedEmail.value = { ...sent, ...(data.sent || {}) };
    } else {
      const data = await res.json().catch(() => ({}));
      errorMessage.value = data.error || '加载发件详情失败';
    }
  } catch (e) { errorMessage.value = '加载详情失败: ' + e.message; }
  finally { loadingDetail.value = false; }
}

function backToMailboxes() { selectedMailbox.value = null; selectedEmail.value = null; }
function backToEmails() { selectedEmail.value = null; }

if (isAdmin.value) loadMailboxes();
</script>

<template>
  <div v-if="!isAdmin" class="flex-1 flex items-center justify-center bg-app">
    <div class="bg-surface shadow-panel border border-line rounded-xl p-10 text-center">
      <i data-lucide="shield-x" class="w-10 h-10 text-faint mx-auto mb-3"></i>
      <p class="text-sub">您没有管理员权限。</p>
    </div>
  </div>
  <div v-else class="flex-1 min-h-0 flex flex-col overflow-hidden bg-app h-full">
    <!-- 顶部：收件箱/发件箱 页签 + 返回管理后台 -->
    <div class="flex items-center gap-3 flex-wrap px-4 py-2 bg-surface border-b border-line shrink-0">
      <RouterLink to="/admin" class="back-link shrink-0">← 管理后台</RouterLink>
      <div class="flex items-center gap-1.5 bg-surface2 p-1 rounded-lg">
        <button @click="switchTab('inbox')" :class="['px-4 py-1.5 rounded-md text-sm font-medium', tab==='inbox' ? 'bg-accent text-accent-ink shadow' : 'text-sub hover:bg-surface3']">收件箱</button>
        <button @click="switchTab('sent')" :class="['px-4 py-1.5 rounded-md text-sm font-medium', tab==='sent' ? 'bg-accent text-accent-ink shadow' : 'text-sub hover:bg-surface3']">发件箱</button>
      </div>
    </div>

    <div class="flex-1 min-h-0 flex overflow-hidden">
    <!-- 邮箱列表（收件箱模式） -->
    <section :class="leftCls">
      <div class="p-4 border-b border-line">
        <h2 class="font-semibold text-main flex items-center gap-2"><i data-lucide="inbox" class="w-4 h-4 text-accent"></i>全部邮箱</h2>
      </div>
      <div class="flex-1 overflow-y-auto divide-y divide-line">
        <div v-if="!loadingMailboxes && mailboxes.length === 0" class="p-8 text-center text-xs text-faint">暂无邮箱</div>
        <div v-for="mb in mailboxes" :key="mb.id" @click="openMailbox(mb)"
          :class="['p-3 cursor-pointer hover:bg-surface3 transition', selectedMailbox?.id === mb.id ? 'bg-accent-soft border-l-4 border-accent' : '']">
          <div class="text-xs font-medium text-main font-mono truncate">{{ mb.address }}</div>
          <div class="flex items-center justify-between mt-1">
            <span class="text-xs text-sub truncate">{{ mb.owner || '未分配' }}</span>
            <span class="text-xs text-faint">邮件 {{ mb.msg_count }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 邮件列表（收件箱模式=该邮箱邮件；发件箱模式=全部已发送） -->
    <section :class="midCls">
      <div class="p-3 border-b border-line flex items-center">
        <h2 v-if="isMobile" @click="backToMailboxes" class="text-sm font-semibold text-main font-mono truncate cursor-pointer">{{ tab === 'sent' ? '发件箱' : (selectedMailbox?.address || '收件箱') }}</h2>
        <h2 v-else class="text-sm font-semibold text-main font-mono truncate">{{ tab === 'sent' ? '全部已发送' : (selectedMailbox?.address || '收件箱') }}</h2>
      </div>
      <div class="flex-1 overflow-y-auto divide-y divide-line">
        <template v-if="tab==='inbox'">
          <div v-if="!loadingEmails && emails.length === 0" class="p-8 text-center text-xs text-faint">该邮箱暂无邮件</div>
          <div v-for="mail in emails" :key="mail.id" @click="openEmail(mail)"
            :class="['p-3 cursor-pointer hover:bg-surface3 transition', selectedEmail?.id === mail.id ? 'bg-accent-soft border-l-4 border-accent' : '']">
            <div class="flex justify-between items-center">
              <span class="text-xs font-semibold text-main truncate">{{ mail.sender }}</span>
              <span class="text-xs text-faint shrink-0">{{ formatDate(mail.received_at) }}</span>
            </div>
            <div class="text-xs text-main truncate mt-0.5">{{ mail.subject || '(无主题)' }}</div>
          </div>
        </template>
        <template v-else>
          <div v-if="!loadingEmails && sentEmails.length === 0" class="p-8 text-center text-xs text-faint">暂无已发送邮件</div>
          <div v-for="s in sentEmails" :key="s.id" @click="openSentEmail(s)"
            :class="['p-3 cursor-pointer hover:bg-surface3 transition', selectedEmail?.id === s.id ? 'bg-accent-soft border-l-4 border-accent' : '']">
            <div class="flex justify-between items-center">
              <span class="text-xs font-semibold text-main truncate">{{ s.from_addr }}</span>
              <span class="text-xs text-faint shrink-0">{{ formatDate(s.created_at) }}</span>
            </div>
            <div class="text-xs text-sub truncate mt-0.5">→ {{ s.to_addrs }}</div>
            <div class="text-xs text-main truncate mt-0.5">{{ s.subject || '(无主题)' }}</div>
          </div>
        </template>
      </div>
    </section>

    <!-- 邮件详情 -->
    <main :class="detailCls">
      <template v-if="selectedEmail">
        <div class="p-4 border-b border-line flex items-center gap-2 justify-between flex-wrap">
          <div class="flex items-center gap-2">
            <button v-if="isMobile" @click="backToEmails" class="mobile-back-button">
              <i data-lucide="chevron-left" class="w-4 h-4"></i><span>返回</span>
            </button>
            <h2 class="text-base font-bold text-main truncate">{{ selectedEmail.subject }}</h2>
          </div>
          <div class="flex bg-surface2 p-1 rounded-lg text-xs shrink-0">
            <button @click="setViewMode('rendered')" :class="['px-3 py-1 rounded-md font-medium', viewMode==='rendered' ? 'bg-accent text-accent-ink shadow' : 'text-sub']">视图</button>
            <button @click="setViewMode('html')" :class="['px-3 py-1 rounded-md font-medium', viewMode==='html' ? 'bg-accent text-accent-ink shadow' : 'text-sub']">HTML</button>
            <button @click="setViewMode('raw')" :class="['px-3 py-1 rounded-md font-medium', viewMode==='raw' ? 'bg-accent text-accent-ink shadow' : 'text-sub']">源码</button>
          </div>
        </div>
        <div class="p-4 border-b border-line space-y-1 text-xs text-sub">
          <template v-if="tab==='sent'">
            <p><span class="font-semibold text-main">发件人：</span> {{ selectedEmail.from_addr }}</p>
            <p><span class="font-semibold text-main">收件人：</span> {{ selectedEmail.to_addrs }}</p>
            <p class="flex items-center gap-1.5">
              <span class="font-semibold text-main">状态：</span>
              <span :class="['px-1.5 py-0.5 rounded', selectedEmail.delivery_status==='delivered' ? 'text-green bg-green-soft' : 'text-warn bg-warn-soft']">{{ deliveryText(selectedEmail.delivery_status) }}</span>
            </p>
            <p><span class="font-semibold text-main">时间：</span> {{ selectedEmail.created_at }}</p>
          </template>
          <template v-else>
            <p><span class="font-semibold text-main">邮箱：</span> {{ selectedEmail.mailbox_address }}</p>
            <p><span class="font-semibold text-main">发件人：</span> {{ selectedEmail.sender }}</p>
            <p><span class="font-semibold text-main">时间：</span> {{ selectedEmail.received_at }}</p>
          </template>
        </div>
        <div class="flex-1 overflow-y-auto p-4">
          <template v-if="!loadingDetail">
            <div v-if="viewMode==='rendered'" class="mail-body"><EmailFrame :content="protectedContent" /></div>
            <pre v-else-if="viewMode==='html'" class="mail-source p-4 rounded-lg font-mono text-xs overflow-x-auto whitespace-pre-wrap border border-line">{{ selectedEmail.html || '无 HTML 内容' }}</pre>
            <pre v-else-if="!loadingRaw" class="bg-surface2 text-main p-4 rounded-lg font-mono text-xs overflow-x-auto whitespace-pre-wrap border border-line">{{ tab==='sent' ? (selectedEmail.content || selectedEmail.text || '无正文') : (selectedEmail.raw_content || '无 RAW 内容') }}</pre>
          </template>
        </div>
      </template>
      <div v-else class="flex-1 flex items-center justify-center text-faint flex-col space-y-2">
        <i data-lucide="mail-open" class="w-12 h-12 stroke-1"></i>
        <p class="text-sm">{{ tab === 'sent' ? '选择一封已发送邮件查看详情' : '选择一个邮箱查看其邮件' }}</p>
      </div>
    </main>
    </div>
  </div>
</template>
