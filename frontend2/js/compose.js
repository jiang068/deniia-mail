// ===== 写邮件页 =====
const { createApp, ref, onMounted } = window.Vue;

import {
    baseUrl, isAdmin, isAuthenticated, authChecking,
    loadConfig, ensureAuth, clearAuth,
    mailboxes, selectedMailbox, quota, currentMailbox, fetchMailboxes, fetchQuota,
    switchMailbox, navFolders, formatDate, refreshIcons, setSelectedMailbox, token,
} from './mail.js';
import { openMailboxDialog } from './mailbox-dialog.js';

const appConfig = {
    setup() {
        const sending = ref(false);
        const errorMessage = ref('');
        const notice = ref('');
        const editMode = ref('new'); // new | forward
        const composerEditMode = ref('text');
        const composerForm = ref({ to: '', subject: '', body: '', html: '' });

        async function boot() {
            const ok = await loadConfig();
            if (ok) {
                const authed = await ensureAuth(true);
                if (authed) {
                    await fetchMailboxes();
                    await fetchQuota();
                    await applyQueryHints();
                }
            }
            refreshIcons();
        }

        // 根据 URL 参数预填（reply / forward）
        async function applyQueryHints() {
            const params = new URLSearchParams(location.search);

            // 转发：需要回源取原邮件正文
            const forwardId = params.get('forward');
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

            // 回复
            const to = params.get('to');
            if (to) {
                editMode.value = 'reply';
                composerForm.value.to = to;
            }
            const subject = params.get('subject');
            if (subject) composerForm.value.subject = subject;
        }

        function doLogout() { clearAuth(); location.href = 'login.html'; }

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
            } finally { sending.value = false; refreshIcons(); }
        }

        // 新建邮箱弹窗（共享模块；创建后刷新邮箱列表/配额）
        function openMailboxDialogHandler() {
            return openMailboxDialog({ onCreated: () => { fetchMailboxes(true); fetchQuota(true); }, refreshIcons });
        }

        onMounted(boot);

        return {
            authChecking, isAuthenticated, isAdmin, mailboxes, selectedMailbox, quota, currentMailbox, navFolders,
            sender: currentMailbox,
            sending, errorMessage, notice, editMode, composerEditMode, composerForm,
            switchMailbox, doLogout, sendEmail, openMailboxDialog: openMailboxDialogHandler,
        };
    }
};

const app = createApp(appConfig);
app.mount('#app');
window.__app = app;
console.log('[DBG-PAGE] 挂载: compose.js', location.pathname, import.meta.url.includes('?v=') ? '[PJAX重挂载]' : '[全量加载]');