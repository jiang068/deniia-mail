<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import {
  currentMailbox, isAuthenticated,
  mailboxes, selectedMailbox, fetchMailboxes,
  formatDate, apiFetch,
  remoteContentLevel, buildEmailDocument, hasExternalImagesOf, hasAdvancedTrackersOf,
} from '../stores/mail.js';
import { isMobile } from '../composables/mobileShell.js';
import EmailFrame from '../components/EmailFrame.vue';

const loadingEmails = ref(false);
const loadingDetail = ref(false);
const errorMessage = ref('');
const emails = ref([]);
const searchQuery = ref('');
const selectedEmail = ref(null);
const viewMode = ref('rendered');
const nextCursor = ref(null);
const loadingMore = ref(false);
const loadingRaw = ref(false);
let listController = null;
let detailController = null;
let listRequestSeq = 0;

// 缓存
const emailDetailCache = new Map();
const emailListCache = new Map();
const LIST_CACHE_TTL = 15000;

const hasExternalImages = computed(() => hasExternalImagesOf(selectedEmail.value?.html || ''));
const hasAdvancedTrackers = computed(() => hasAdvancedTrackersOf(selectedEmail.value?.html || ''));

const protectedContent = computed(() => {
  remoteContentLevel.value; // 显式依赖
  const raw = selectedEmail.value?.html || selectedEmail.value?.text || '';
  return buildEmailDocument(raw);
});

const filteredEmails = computed(() => {
  if (!searchQuery.value) return emails.value;
  const q = searchQuery.value.toLowerCase();
  return (emails.value || []).filter(e =>
    (e.subject && e.subject.toLowerCase().includes(q)) ||
    (e.sender && e.sender.toLowerCase().includes(q)) ||
    (e.from_addr && e.from_addr.toLowerCase().includes(q)));
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

async function fetchEmails(force = false) {
  if (!isAuthenticated.value || !currentMailbox.value) return;
  const cacheKey = currentMailbox.value;
  const cached = emailListCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.timestamp < LIST_CACHE_TTL) { emails.value = cached.data; return; }
  listController?.abort();
  listController = new AbortController();
  const requestSeq = ++listRequestSeq;
  loadingEmails.value = true;
  try {
    const res = await apiFetch(`/api/emails?mailbox=${encodeURIComponent(currentMailbox.value)}`, { signal: listController.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    if (requestSeq !== listRequestSeq) return;
    const list = (data && data.emails) ? data.emails : [];
    emails.value = list;
    nextCursor.value = data?.next_cursor || null;
    emailListCache.set(cacheKey, { data: list, timestamp: Date.now() });
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error('fetch emails error:', e);
    errorMessage.value = '获取邮件失败: ' + e.message;
    emails.value = [];
  } finally { if (requestSeq === listRequestSeq) loadingEmails.value = false; }
}

async function loadMore() {
  if (!nextCursor.value || loadingMore.value || !isAuthenticated.value || !currentMailbox.value) return;
  const requestMailbox = currentMailbox.value;
  loadingMore.value = true;
  try {
    const res = await apiFetch(`/api/emails?mailbox=${encodeURIComponent(requestMailbox)}&cursor=${encodeURIComponent(nextCursor.value)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    if (requestMailbox !== currentMailbox.value) return;
    emails.value = [...emails.value, ...(data?.emails || [])];
    nextCursor.value = data?.next_cursor || null;
    emailListCache.set(requestMailbox, { data: emails.value, timestamp: Date.now() });
  } catch (e) { if (e.name !== 'AbortError') console.error('load more emails error:', e); }
  finally { loadingMore.value = false; }
}

async function selectEmail(mail) {
  remoteContentLevel.value = 0;
  const cacheKey = `email-${mail.id}`;
  const cached = emailDetailCache.get(cacheKey);
  if (cached) {
    selectedEmail.value = { ...mail, ...cached };
    viewMode.value = 'rendered';
    return;
  }
  selectedEmail.value = { ...mail };
  viewMode.value = 'rendered';
  loadingDetail.value = true;
  detailController?.abort();
  detailController = new AbortController();
  try {
    const res = await apiFetch(`/api/email/${mail.id}`, { signal: detailController.signal });
    if (res.ok) {
      const data = await res.json();
      const obj = data.email || {};
      emailDetailCache.set(cacheKey, obj);
      selectedEmail.value = { ...mail, ...obj };
    }
  } catch (e) { if (e.name !== 'AbortError') console.error('load detail error:', e); }
  finally { loadingDetail.value = false; }
}

async function setViewMode(mode) {
  viewMode.value = mode;
  if (mode !== 'raw' || !selectedEmail.value || selectedEmail.value.raw_content !== undefined || loadingRaw.value) return;
  loadingRaw.value = true;
  try {
    const res = await apiFetch(`/api/email/${selectedEmail.value.id}?raw=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const obj = data.email || {};
    emailDetailCache.set(`email-${selectedEmail.value.id}`, obj);
    selectedEmail.value = { ...selectedEmail.value, ...obj };
  } catch (e) { console.error('load raw email error:', e); }
  finally { loadingRaw.value = false; }
}

async function deleteEmail(id) {
  if (!confirm('确定要删除这封邮件吗？')) return;
  try {
    const res = await apiFetch(`/api/email/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除失败');
    emailDetailCache.delete(`email-${id}`);
    emailListCache.delete(currentMailbox.value);
    selectedEmail.value = null;
    fetchEmails();
  } catch (err) { errorMessage.value = '删除失败: ' + err.message; }
}

function setLevel(l) { remoteContentLevel.value = l; }

// 挂载：拉取列表
onMounted(async () => {
  await fetchMailboxes();
  await fetchEmails();
});

const statusMap = {
  'sending': ['发送中', 'text-warn bg-warn-soft'],
  'delivered': ['已送达', 'text-green bg-green-soft'],
  'opened': ['已读', 'text-blue bg-blue-soft'],
  'bounced': ['已退回', 'text-danger bg-danger-soft'],
  'complained': ['被举报', 'text-warn bg-warn-soft'],
  'delayed': ['投递延迟', 'text-warn bg-warn-soft'],
  'failed': ['发送失败', 'text-danger bg-danger-soft'],
  'suppressed': ['已抑制', 'text-danger bg-danger-soft'],
  'sent': ['已发送', 'text-sub bg-surface2'],
};
function statusCls(s, detail = false) {
  const m = statusMap[s] || [s || '', 'text-sub bg-surface2'];
  return { t: m[0], c: m[1] };
}

// 切换邮箱（侧栏操作）时刷新当前列表
let mailboxPrev = selectedMailbox.value;
watch(() => selectedMailbox.value, async (nv) => {
  if (nv !== mailboxPrev) { mailboxPrev = nv; await fetchEmails(); }
});
</script>

<template>
  <div class="flex-1 flex overflow-hidden bg-app h-full">
    <!-- 邮件列表 -->
    <div :class="listColumnCls">
      <div class="p-4 border-b border-line">
        <div class="relative flex items-center">
          <i data-lucide="search" class="w-4 h-4 absolute left-3 top-3 text-faint md:top-2.5"></i>
          <input type="text" v-model="searchQuery" placeholder="搜索邮件..."
            class="w-full pl-9 pr-3 py-1.5 bg-surface2 text-main border border-line rounded-lg text-sm focus:ring-2 ring-accent focus:outline-none">
        </div>
      </div>

      <div class="flex-1 overflow-y-auto divide-y divide-line">
        <div v-if="loadingEmails" class="p-8 text-center text-xs text-faint">加载中...</div>
        <div v-else-if="filteredEmails.length === 0" class="p-8 text-center text-xs text-faint">暂无邮件</div>
        <div v-for="mail in filteredEmails" :key="mail.id"
          @click="selectEmail(mail)"
          :class="['p-4 cursor-pointer hover:bg-surface3 transition', selectedEmail?.id === mail.id ? 'bg-accent-soft border-l-4 border-accent' : '']">
          <div class="flex justify-between items-start mb-1">
            <span class="text-sm font-semibold truncate text-main">{{ mail.sender || mail.from_addr }}</span>
            <span class="text-xs text-faint flex-shrink-0">{{ formatDate(mail.received_at || mail.created_at) }}</span>
          </div>
          <h4 class="text-xs font-medium text-main truncate mb-1">{{ mail.subject || '(无主题)' }}</h4>
          <div class="flex items-center gap-2">
            <p class="text-xs text-sub line-clamp-2 flex-1 min-w-0">{{ mail.preview }}</p>
            <span v-if="mail.delivery_status && mail.delivery_status !== 'sent'"
              :class="['text-xs font-medium shrink-0 px-1.5 py-0.5 rounded', statusCls(mail.delivery_status).c]">{{ statusCls(mail.delivery_status).t }}</span>
          </div>
        </div>
        <button v-if="nextCursor" @click="loadMore" :disabled="loadingMore"
          class="w-full py-3 text-xs text-accent hover:bg-surface3 disabled:opacity-50">
          {{ loadingMore ? '加载中...' : '加载更多' }}
        </button>
      </div>
    </div>

    <!-- 邮件详情 -->
    <main :class="detailCls">
      <template v-if="selectedEmail">
        <div class="p-4 border-b border-line flex flex-wrap items-center gap-2 justify-between">
          <div class="flex items-center gap-2 flex-wrap">
            <button v-if="isMobile" @click="backToList"
              class="px-2.5 py-1.5 bg-surface2 border border-line rounded-md text-xs font-medium text-sub hover:bg-surface3 flex items-center space-x-1">
              <i data-lucide="chevron-left" class="w-4 h-4"></i><span>返回</span>
            </button>
            <RouterLink :to="'/compose?to=' + encodeURIComponent(selectedEmail.sender || selectedEmail.from_addr) + '&subject=' + encodeURIComponent('Re: ' + (selectedEmail.subject||''))"
              class="px-3 py-1.5 bg-surface2 border border-line rounded-md text-xs font-medium text-main hover:bg-surface3 flex items-center space-x-1">
              <i data-lucide="reply" class="w-3.5 h-3.5"></i><span>回复</span>
            </RouterLink>
            <RouterLink :to="'/compose?forward=' + selectedEmail.id + '&from=' + encodeURIComponent(currentMailbox)"
              class="px-3 py-1.5 bg-surface2 border border-line rounded-md text-xs font-medium text-main hover:bg-surface3 flex items-center space-x-1">
              <i data-lucide="forward" class="w-3.5 h-3.5"></i><span>转发</span>
            </RouterLink>
            <button @click="deleteEmail(selectedEmail.id)"
              class="px-3 py-1.5 bg-surface2 border border-danger-soft text-danger rounded-md text-xs font-medium hover:bg-danger-soft flex items-center space-x-1">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i><span>删除</span>
            </button>
          </div>
          <div class="flex bg-surface2 p-1 rounded-lg text-xs">
              <button @click="setViewMode('rendered')"
              :class="['px-3 py-1 rounded-md font-medium', viewMode==='rendered' ? 'bg-accent text-accent-ink shadow' : 'text-sub']">视图</button>
            <button @click="setViewMode('html')"
              :class="['px-3 py-1 rounded-md font-medium', viewMode==='html' ? 'bg-accent text-accent-ink shadow' : 'text-sub']">HTML</button>
            <button @click="setViewMode('raw')"
              :class="['px-3 py-1 rounded-md font-medium', viewMode==='raw' ? 'bg-accent text-accent-ink shadow' : 'text-sub']">原始</button>
          </div>
        </div>

        <div class="p-6 border-b border-line">
          <h2 class="text-xl font-bold text-main mb-3">{{ selectedEmail.subject }}</h2>
          <div class="space-y-1 text-xs text-sub">
            <p><span class="font-semibold text-main">发件人：</span> {{ selectedEmail.sender || selectedEmail.from_addr }}</p>
            <p><span class="font-semibold text-main">收件人：</span> {{ selectedEmail.to_addrs }}</p>
            <p><span class="font-semibold text-main">时间：</span> {{ selectedEmail.received_at || selectedEmail.created_at }}</p>
            <p v-if="selectedEmail.delivery_status" class="flex items-center gap-1.5">
              <span class="font-semibold text-main">状态：</span>
              <span :class="statusCls(selectedEmail.delivery_status, true).c">{{ statusCls(selectedEmail.delivery_status, true).t }}</span>
            </p>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-6">
          <div class="mb-4 p-3 rounded-lg text-xs flex flex-wrap items-center justify-between gap-3 border border-line">
            <template v-if="remoteContentLevel === 0">
              <div class="flex-1 min-w-[200px] flex items-center gap-1.5 text-warn">
                <i data-lucide="shield-alert" class="w-4 h-4 shrink-0"></i>
                <span v-if="hasExternalImages || hasAdvancedTrackers">此邮件包含远程内容（图片及可能的追踪器），已全部拦截，未泄露阅读状态。</span>
                <span v-else>此邮件已按最安全方式显示。</span>
              </div>
              <div v-if="hasExternalImages || hasAdvancedTrackers" class="flex gap-2 shrink-0">
                <button @click="setLevel(1)" class="px-2.5 py-1 bg-accent text-accent-ink rounded-md font-medium">只加载图片</button>
                <button @click="setLevel(2)" class="px-2.5 py-1 bg-danger text-white rounded-md font-medium">加载全部</button>
              </div>
            </template>
            <template v-else>
              <div class="flex-1 min-w-[200px] flex items-center gap-1.5" :class="remoteContentLevel===1 ? 'text-blue' : 'text-danger'">
                <i data-lucide="feather" class="w-4 h-4 shrink-0"></i>
                <span v-if="remoteContentLevel===1">已只加载图片外链。<span v-if="hasAdvancedTrackers">其余追踪资源（CSS/媒体/预加载）仍被拦截。</span></span>
                <span v-else>已加载全部远程内容，可能泄露 IP 和阅读状态。</span>
              </div>
              <button @click="setLevel(0)" class="px-2.5 py-1 bg-surface2 text-sub border border-line rounded-md font-medium shrink-0">恢复拦截</button>
            </template>
          </div>
          <div v-if="loadingDetail" class="text-sm text-faint py-4">加载正文...</div>
          <template v-else>
            <div v-if="viewMode==='rendered'" class="mail-body"><EmailFrame :content="protectedContent" /></div>
            <pre v-else-if="viewMode==='html'" class="bg-surface2 text-green p-4 rounded-lg font-mono text-xs overflow-x-auto whitespace-pre-wrap border border-line">{{ selectedEmail.html || '无 HTML 内容' }}</pre>
            <div v-else-if="viewMode==='raw' && loadingRaw" class="text-sm text-faint py-4">加载原始邮件...</div>
            <pre v-else-if="viewMode==='raw'" class="bg-surface2 text-main p-4 rounded-lg font-mono text-xs overflow-x-auto whitespace-pre-wrap border border-line">{{ selectedEmail.raw_content || '无 RAW 内容' }}</pre>
          </template>
        </div>
      </template>

      <div v-else class="flex-1 flex items-center justify-center text-faint flex-col space-y-2">
        <i data-lucide="mail-open" class="w-12 h-12 stroke-1"></i>
        <p class="text-sm">选择一封邮件查看详情</p>
      </div>
    </main>
  </div>
</template>
