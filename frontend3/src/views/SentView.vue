<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import {
  baseUrl, token, currentMailbox, isAuthenticated,
  mailboxes, selectedMailbox, fetchMailboxes, fetchQuota,
  formatDate, refreshIcons, protectContent, setSelectedMailbox,
} from '../stores/mail.js';
import { isMobile } from '../composables/mobileShell.js';

const route = useRoute();

const loadingEmails = ref(false);
const loadingDetail = ref(false);
const errorMessage = ref('');
const emails = ref([]);
const searchQuery = ref('');
const selectedEmail = ref(null);
const emailDetailCache = new Map();
const emailListCache = new Map();
const LIST_CACHE_TTL = 10000;

const checkingStatus = ref(false);
const viewMode = ref('rendered'); // rendered | html | raw

const filteredEmails = computed(() => {
  if (!searchQuery.value) return emails.value;
  const q = searchQuery.value.toLowerCase();
  return (emails.value || []).filter(e =>
    (e.subject && e.subject.toLowerCase().includes(q)) ||
    (e.to_addrs && e.to_addrs.toLowerCase().includes(q)));
});

const listColumnCls = computed(() => {
  if (!isMobile.value) return 'w-80 bg-surface border-r border-line flex flex-col flex-shrink-0';
  return selectedEmail.value ? 'hidden' : 'flex-1 bg-surface border-r border-line flex flex-col min-w-0';
});
const detailCls = computed(() => {
  if (!isMobile.value) return 'flex-1 bg-surface flex flex-col overflow-hidden';
  return selectedEmail.value ? 'flex-1 bg-surface flex flex-col overflow-hidden' : 'hidden';
});
function backToList() { selectedEmail.value = null; window.scrollTo(0, 0); }

const sentContent = computed(() => {
  const raw = selectedEmail.value?.html || selectedEmail.value?.text || '';
  return protectContent(raw);
});

async function fetchEmails(force = false) {
  if (!isAuthenticated.value || !currentMailbox.value) return;
  const cacheKey = currentMailbox.value;
  const cached = emailListCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.timestamp < LIST_CACHE_TTL) { emails.value = cached.data; return; }
  loadingEmails.value = true;
  try {
    const res = await fetch(`${baseUrl.value}/api/sent?from=${encodeURIComponent(currentMailbox.value)}`, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    const list = (data && data.sent) ? data.sent : [];
    emails.value = list;
    emailListCache.set(cacheKey, { data: list, timestamp: Date.now() });
  } catch (e) { console.error('fetch sent error:', e); emails.value = []; }
  finally { loadingEmails.value = false; await refreshIcons(); }
}

async function switchMailbox(address) {
  setSelectedMailbox(address);
  selectedEmail.value = null;
  await fetchEmails();
}

async function selectEmail(mail) {
  const cacheKey = `sent-${mail.id}`;
  const cached = emailDetailCache.get(cacheKey);
  if (cached) { selectedEmail.value = { ...mail, ...cached }; await refreshIcons(); return; }
  selectedEmail.value = { ...mail };
  loadingDetail.value = true;
  try {
    const res = await fetch(`${baseUrl.value}/api/sent/${mail.id}`, { headers: { Authorization: `Bearer ${token.value}` } });
    if (res.ok) {
      const data = await res.json();
      const obj = data.sent || {};
      emailDetailCache.set(cacheKey, obj);
      selectedEmail.value = { ...mail, ...obj };
    }
  } catch (e) { console.error('load sent detail error:', e); }
  finally { loadingDetail.value = false; await refreshIcons(); }
}

// 手动查询投递状态（仅在用户点击时调一次 Resend）
async function queryStatus() {
  if (!isAuthenticated.value || !token.value || checkingStatus.value) return;
  checkingStatus.value = true;
  try {
    const sentList = (emails.value || []).filter(e => e.delivery_status && e.delivery_status !== 'delivered');
    if (sentList.length === 0) return;
    const res = await fetch(`${baseUrl.value}/api/emails/check-status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ ids: sentList.map(e => e.id) })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.results) {
        const up = {};
        for (const r of data.results) up[r.id] = r.delivery_status;
        emails.value = emails.value.map(e => ({ ...e, delivery_status: up[e.id] || e.delivery_status }));
      }
    }
  } catch (e) { /* silent */ }
  finally { checkingStatus.value = false; }
}

const statusMap = {
  'sending': ['发送中', 'text-warn bg-warn-soft'],
  'delivered': ['已送达', 'text-green bg-green-soft'],
  'opened': ['已读', 'text-blue bg-blue-soft'],
  'bounced': ['已退回', 'text-danger bg-danger-soft'],
  'complained': ['被举报', 'text-warn bg-warn-soft'],
  'sent': ['已发送', 'text-sub bg-surface2'],
};
function statusCls(s) { const m = statusMap[s] || [s || '', 'text-sub bg-surface2']; return { t: m[0], c: m[1] }; }

onMounted(async () => {
  await fetchMailboxes();
  await fetchQuota();
  await fetchEmails();
});

let mailboxPrev = selectedMailbox.value;
watch(() => selectedMailbox.value, async (nv) => {
  if (nv !== mailboxPrev) { mailboxPrev = nv; await fetchEmails(); }
});
watch(() => route.name, () => { fetchEmails(); });
</script>

<template>
  <div class="flex-1 flex overflow-hidden bg-app h-full">
    <!-- 已发送列表 -->
    <div :class="listColumnCls">
      <div class="p-4 border-b border-line">
        <div class="relative">
          <i data-lucide="search" class="w-4 h-4 absolute left-3 top-3 text-faint"></i>
          <input type="text" v-model="searchQuery" placeholder="搜索已发送..."
            class="w-full pl-9 pr-3 py-1.5 bg-surface2 text-main border border-line rounded-lg text-sm focus:ring-2 ring-accent focus:outline-none">
        </div>
        <button @click="queryStatus" :disabled="checkingStatus"
          class="mt-2 w-full py-1.5 bg-surface2 text-sub border border-line rounded-lg text-xs font-medium hover:bg-surface3 hover:text-accent transition flex items-center justify-center space-x-1.5">
          <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
          <span>{{ checkingStatus ? '查询中...' : '查询发送状态' }}</span>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto divide-y divide-line">
        <div v-if="loadingEmails" class="p-8 text-center text-xs text-faint">加载中...</div>
        <div v-else-if="filteredEmails.length === 0" class="p-8 text-center text-xs text-faint">暂无已发送邮件</div>
        <div v-for="mail in filteredEmails" :key="mail.id"
          @click="selectEmail(mail)"
          :class="['p-4 cursor-pointer hover:bg-surface3 transition', selectedEmail?.id === mail.id ? 'bg-accent-soft border-l-4 border-accent' : '']">
          <div class="flex justify-between items-start mb-1">
            <span class="text-sm font-semibold truncate text-main">{{ mail.to_addrs }}</span>
            <span class="text-xs text-faint flex-shrink-0">{{ formatDate(mail.created_at) }}</span>
          </div>
          <h4 class="text-xs font-medium text-main truncate mb-1">{{ mail.subject || '(无主题)' }}</h4>
          <div class="flex items-center gap-2">
            <p class="text-xs text-sub line-clamp-2 flex-1 min-w-0">{{ mail.preview }}</p>
            <span :class="['text-xs font-medium shrink-0 px-1.5 py-0.5 rounded', statusCls(mail.delivery_status).c]">{{ statusCls(mail.delivery_status).t }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 详情 -->
    <main :class="detailCls">
      <template v-if="selectedEmail">
        <div class="p-4 md:p-6 border-b border-line">
          <div class="flex items-center gap-2 mb-3">
            <button v-if="isMobile" @click="backToList"
              class="px-2.5 py-1.5 bg-surface2 border border-line rounded-md text-xs font-medium text-sub hover:bg-surface3 flex items-center space-x-1">
              <i data-lucide="chevron-left" class="w-4 h-4"></i><span>返回</span>
            </button>
            <h2 class="text-xl font-bold text-main flex-1 min-w-0 truncate">{{ selectedEmail.subject }}</h2>
            <div class="flex bg-surface2 p-1 rounded-lg text-xs shrink-0">
              <button @click="viewMode='rendered'"
                :class="['px-3 py-1 rounded-md font-medium', viewMode==='rendered' ? 'bg-accent text-accent-ink shadow' : 'text-sub']">视图</button>
              <button @click="viewMode='html'"
                :class="['px-3 py-1 rounded-md font-medium', viewMode==='html' ? 'bg-accent text-accent-ink shadow' : 'text-sub']">HTML</button>
              <button @click="viewMode='raw'"
                :class="['px-3 py-1 rounded-md font-medium', viewMode==='raw' ? 'bg-accent text-accent-ink shadow' : 'text-sub']">源码</button>
            </div>
          </div>
          <div class="space-y-1 text-xs text-sub">
            <p><span class="font-semibold text-main">收件人：</span> {{ selectedEmail.to_addrs }}</p>
            <p><span class="font-semibold text-main">时间：</span> {{ selectedEmail.created_at }}</p>
            <p class="flex items-center gap-1.5">
              <span class="font-semibold text-main">状态：</span>
              <span :class="statusCls(selectedEmail.delivery_status).c">{{ statusCls(selectedEmail.delivery_status).t }}</span>
            </p>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-4 md:p-6">
          <div v-if="loadingDetail" class="text-sm text-faint py-4">加载正文...</div>
          <div v-else-if="viewMode==='rendered'" class="mail-body" v-html="sentContent"></div>
          <pre v-else-if="viewMode==='html'" class="bg-surface2 text-green p-4 rounded-lg font-mono text-xs overflow-x-auto whitespace-pre-wrap border border-line">{{ selectedEmail.html || '无 HTML 内容' }}</pre>
          <pre v-else class="bg-surface2 text-main p-4 rounded-lg font-mono text-xs overflow-x-auto whitespace-pre-wrap border border-line">{{ selectedEmail.text || selectedEmail.text_content || '无源码内容' }}</pre>
        </div>
      </template>
      <div v-else class="flex-1 flex items-center justify-center text-faint flex-col space-y-2">
        <i data-lucide="send" class="w-12 h-12 stroke-1"></i>
        <p class="text-sm">选择一封已发送邮件查看详情</p>
      </div>
    </main>
  </div>
</template>