<script setup>
import { ref, computed, onMounted } from 'vue';
import {
  baseUrl, currentMailbox, isAuthenticated,
  mailboxes, selectedMailbox, quota, fetchMailboxes, fetchQuota,
  switchMailbox, refreshIcons, clearAuth, token, buildEmailDocument,
} from '../stores/mail.js';
import { useRouter } from 'vue-router';
import { isMobile } from '../composables/mobileShell.js';
import EmailFrame from '../components/EmailFrame.vue';

const props = defineProps({
  to: { type: String, default: '' },
  subject: { type: String, default: '' },
  forward: { type: String, default: '' },
  from: { type: String, default: '' },
});

const router = useRouter();

const sending = ref(false);
const errorMessage = ref('');
const notice = ref('');
const editMode = ref('new'); // new | forward
const composerEditMode = ref('text');
const composerForm = ref({ to: '', subject: '', body: '', html: '' });

// 纯文本正文 HTML 转义，用于「预览」模式安全展示
function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 预览：与当前源码/正文保持实时同步（DOMPurify 清洗后，以 iframe 隔离渲染）
const composerPreview = computed(() => {
  if (composerForm.value.html) {
    return buildEmailDocument(composerForm.value.html);
  }
  const plain = escapeHtml(composerForm.value.body || '');
  return buildEmailDocument(`<div style="white-space: pre-wrap; font-family: sans-serif;">${plain}</div>`);
});

// 根据 props（来自路由 query）预填 reply / forward
async function applyQueryHints() {
  const forwardId = props.forward;
  if (forwardId) {
    editMode.value = 'forward';
    try {
      const res = await fetch(`${baseUrl.value}/api/email/${forwardId}`, {
        headers: { Authorization: `Bearer ${token.value}` }
      });
      if (res.ok) {
        const data = await res.json();
        const mail = data.email || {};
        composerForm.value = {
          to: '',
          subject: `Fwd: ${mail.subject || ''}`,
          body: `\n\n--- 转发邮件 ---\n发件人: ${mail.sender || mail.from_addr || ''}\n${mail.text || mail.preview || ''}`,
          html: mail.html || ''
        };
        composerEditMode.value = mail.html ? 'html' : 'text';
      }
    } catch (e) { /* ignore */ }
    return;
  }

  if (props.to) {
    editMode.value = 'reply';
    composerForm.value.to = props.to;
  }
  if (props.subject) composerForm.value.subject = props.subject;
}

async function boot() {
  await fetchMailboxes();
  await fetchQuota();
  await applyQueryHints();
  await refreshIcons();
}

async function sendEmail() {
  sending.value = true; errorMessage.value = ''; notice.value = '';
  try {
    const payload = {
      from: currentMailbox.value,
      to: composerForm.value.to,
      subject: composerForm.value.subject,
      text: composerForm.value.body,
      html: composerEditMode.value === 'html' ? composerForm.value.html : undefined
    };
    const res = await fetch(`${baseUrl.value}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      notice.value = '发送成功！可在「已发送」中查看投递状态。';
      composerForm.value = { to: '', subject: '', body: '', html: '' };
    } else {
      throw new Error(data.error || '发送失败');
    }
  } catch (err) {
    errorMessage.value = '发送失败: ' + err.message;
  } finally { sending.value = false; await refreshIcons(); }
}

function doLogout() { clearAuth(); router.push({ name: 'login' }); }

onMounted(boot);
</script>

<template>
  <main class="flex-1 bg-surface flex flex-col overflow-hidden h-full">
    <div class="p-4 border-b border-line flex flex-wrap justify-between items-center gap-2">
      <h3 class="font-bold text-main flex items-center space-x-2">
        <i data-lucide="square-pen" class="w-5 h-5 text-accent"></i>
        <span>{{ editMode === 'forward' ? '转发邮件' : '撰写新邮件' }}</span>
      </h3>
      <div class="flex items-center gap-2">
        <button v-if="isMobile" @click="doLogout"
          class="px-3 py-2 bg-surface2 border border-line rounded-lg text-sm font-medium text-danger hover:bg-danger-soft">退出</button>
        <RouterLink to="/inbox" class="px-4 py-2 bg-surface2 border border-line rounded-lg text-sm font-medium text-sub hover:bg-surface3">返回收件箱</RouterLink>
      </div>
    </div>

    <div v-if="errorMessage" class="mx-4 md:mx-6 mt-4 bg-danger-soft border border-danger-soft text-danger text-sm rounded-lg px-4 py-2">{{ errorMessage }}</div>
    <div v-if="notice" class="mx-4 md:mx-6 mt-4 bg-green-soft border border-green-soft text-green text-sm rounded-lg px-4 py-2">{{ notice }}</div>

    <div class="p-4 md:p-6 flex-1 flex flex-col space-y-4 overflow-y-auto">
      <div class="grid grid-cols-1 gap-3 text-sm">
        <div>
          <label class="block text-xs font-medium text-sub mb-1">收件人 (To)</label>
          <input type="email" v-model="composerForm.to" placeholder="收件人"
            class="w-full px-3 py-2 bg-surface2 text-main border border-line rounded-lg focus:ring-2 ring-accent text-sm">
        </div>
        <div>
          <label class="block text-xs font-medium text-sub mb-1">主题</label>
          <input type="text" v-model="composerForm.subject" placeholder="主题"
            class="w-full px-3 py-2 bg-surface2 text-main border border-line rounded-lg focus:ring-2 ring-accent text-sm font-medium">
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line">
        <div class="flex items-center space-x-2 min-w-0">
          <span class="text-xs text-faint font-medium shrink-0">发件人：</span>
          <select :value="selectedMailbox" @change="switchMailbox($event.target.value)"
            class="bg-surface2 text-main border border-line rounded-lg px-2 py-1 text-xs focus:ring-2 ring-accent max-w-[45vw] truncate">
            <option v-for="mb in mailboxes" :key="mb.id" :value="mb.address">{{ mb.address }}</option>
          </select>
        </div>
        <div class="flex space-x-2 text-xs">
          <button @click="composerEditMode='text'"
            :class="['px-2.5 py-1 rounded', composerEditMode==='text' ? 'bg-accent text-accent-ink' : 'bg-surface2 text-sub border border-line']">纯文本</button>
          <button @click="composerEditMode='html'"
            :class="['px-2.5 py-1 rounded', composerEditMode==='html' ? 'bg-accent text-accent-ink' : 'bg-surface2 text-sub border border-line']">HTML</button>
          <button @click="composerEditMode='preview'"
            :class="['px-2.5 py-1 rounded', composerEditMode==='preview' ? 'bg-accent text-accent-ink' : 'bg-surface2 text-sub border border-line']">预览</button>
        </div>
      </div>

      <div class="flex-1 flex flex-col">
        <textarea v-if="composerEditMode==='text'" v-model="composerForm.body"
          placeholder="编写邮件内容..."
          class="w-full flex-1 p-3 bg-surface2 text-main border border-line rounded-lg text-sm resize-none focus:ring-2 ring-accent"></textarea>
        <textarea v-else-if="composerEditMode==='html'" v-model="composerForm.html"
          placeholder="<html><body>HTML 源码...</body></html>"
          class="w-full flex-1 p-3 bg-surface2 text-main border border-line rounded-lg text-xs font-mono resize-none focus:ring-2 ring-accent"></textarea>
        <div v-else class="w-full flex-1 overflow-y-auto p-3 mail-body-bg border border-line rounded-lg"><EmailFrame :content="composerPreview" /></div>
      </div>
    </div>

    <div class="px-4 md:px-6 py-3 border-t border-line flex flex-wrap justify-between items-center gap-2">
      <span class="text-xs text-faint">发送后将可在「已发送」中查看状态</span>
      <div class="flex space-x-3">
        <RouterLink to="/inbox" class="px-4 py-2 border border-line rounded-lg text-sm font-medium text-sub hover:bg-surface3">取消</RouterLink>
        <button @click="sendEmail" :disabled="sending"
          class="px-5 py-2 bg-accent hover-bg-accent-h text-accent-ink rounded-lg text-sm font-medium shadow flex items-center space-x-1">
          <i data-lucide="send" class="w-4 h-4"></i>
          <span>{{ sending ? '发送中...' : '发送' }}</span>
        </button>
      </div>
    </div>
  </main>
</template>