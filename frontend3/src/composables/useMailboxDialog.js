// ============================================================
//  共享「新建邮箱」弹窗状态
//  由原 multi-page 的 mailbox-dialog.js 迁移而来。SPA 中弹窗 DOM 由
//  <MailboxDialog /> 组件声明式渲染（放在 App.vue / 侧栏内），
//  本 composable 只提供 open 状态与打开/创建逻辑，任何组件可调用。
// ============================================================
import { ref } from 'vue';
import { baseUrl, quota, defaultDomain, isAdmin, token, fetchQuota, setSelectedMailbox } from '../stores/mail.js';

const dialogOpen = ref(false);
const dialogError = ref('');
const dialogQuotaText = ref('');
const customName = ref('');

function showError(msg) { dialogError.value = msg; }

function closeMailboxDialog() { dialogOpen.value = false; }

async function afterCreated(email) {
    closeMailboxDialog();
    customName.value = '';
    showError('');
    setSelectedMailbox(email);
}

async function createRandom() {
    showError('');
    try {
        const res = await fetch(`${baseUrl.value}/api/generate`, { headers: { Authorization: `Bearer ${token.value}` } });
        const data = await res.json().catch(() => ({}));
        if (data.email) await afterCreated(data.email);
        else showError(data.error || '生成失败');
    } catch (e) { showError('生成失败: ' + e.message); }
}

async function createCustom() {
    const name = customName.value.trim().toLowerCase();
    if (!name || !/^[a-z0-9._-]{1,64}$/.test(name)) {
        showError('名称只能包含小写字母、数字、.-_（最长 64 位）');
        return;
    }
    showError('');
    try {
        const res = await fetch(`${baseUrl.value}/api/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
            body: JSON.stringify({ local: name })
        });
        const data = await res.json().catch(() => ({}));
        if (data.email) await afterCreated(data.email);
        else showError(data.error || '创建失败');
    } catch (e) { showError('创建失败: ' + e.message); }
}

async function openMailboxDialog() {
    // 打开前先刷新配额并检查上限
    await fetchQuota(true);
    dialogQuotaText.value = isAdmin.value ? '不限' : (quota.value.used + ' / ' + quota.value.limit);
    showError('');
    if (!isAdmin.value && quota.value.remaining <= 0) {
        showError('邮箱数量已达上限（' + quota.value.limit + ' 个）');
    }
    dialogOpen.value = true;
}

export { dialogOpen, dialogError, dialogQuotaText, customName, openMailboxDialog, closeMailboxDialog, createRandom, createCustom, showError };