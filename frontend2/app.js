const { createApp, ref, computed, onMounted, nextTick } = Vue;

createApp({
    setup() {
        // ===== State =====
        const isAuthenticated = ref(false);
        const loading = ref(false);
        const loadingEmails = ref(false);
        const loadingDetail = ref(false);
        const sending = ref(false);

        // Config
        const configError = ref(false);
        const configErrorMessage = ref('');
        const baseUrl = ref('');
        const defaultDomain = ref('your-domain.com');

        // Auth
        const token = ref(localStorage.getItem('cf_mail_token') || '');
        const currentUser = ref(localStorage.getItem('cf_mail_user') || '');
        const isAdmin = ref(false);
        const loginForm = ref({ username: '', password: '' });
        const registerForm = ref({ username: '', password: '' });
        const showRegister = ref(false);
        const errorMessage = ref('');

        // Setup (first-run)
        const showSetup = ref(false);
        const setupLoading = ref(false);
        const setupResult = ref(null);

        // Mailboxes
        const mailboxes = ref([]);
        const selectedMailbox = ref('');

        // Emails
        const currentFolder = ref('inbox');
        const searchQuery = ref('');
        const selectedEmail = ref(null);
        const viewMode = ref('rendered');
        const emails = ref([]);

        // Composer
        const showComposer = ref(false);
        const composerEditMode = ref('text');
        const composerForm = ref({ to: '', subject: '', body: '', html: '' });

        // Admin
        const showAdmin = ref(false);
        const adminSettings = ref({ allow_registration: 'false', daily_send_limit: '50' });
        const adminUsers = ref([]);

        const navFolders = ref([
            { id: 'inbox', label: '收件箱', icon: 'inbox' },
            { id: 'sent', label: '已发送', icon: 'send' }
        ]);

        const currentMailbox = computed(() => {
            return selectedMailbox.value ||
                (currentUser.value ? `${currentUser.value}@${defaultDomain.value}` : '');
        });

        // ===== Config & Init =====

        const loadConfig = async () => {
            try {
                const res = await fetch('config.json');
                if (!res.ok) throw new Error('未找到 config.json 配置文件');
                const cfg = await res.json();

                let url = (cfg.baseUrl || '').trim();
                if (url.endsWith('/')) url = url.slice(0, -1);

                if (!url || url.includes('your-worker-subdomain.workers.dev')) {
                    throw new Error('请在 config.json 中写入真实的 Worker 地址');
                }

                baseUrl.value = url;
                if (cfg.defaultDomain) defaultDomain.value = cfg.defaultDomain.trim();
                configError.value = false;

                if (token.value && currentUser.value) {
                    await validateToken();
                } else {
                    await checkAdminSetup();
                }
            } catch (err) {
                console.error('config error:', err);
                configError.value = true;
                configErrorMessage.value = err.message;
            } finally {
                refreshIcons();
            }
        };

        const validateToken = async () => {
            try {
                const res = await fetch(`${baseUrl.value}/api/mailboxes`, {
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    mailboxes.value = data.mailboxes || [];
                    if (mailboxes.value.length > 0) {
                        selectedMailbox.value = mailboxes.value[0].address;
                    }
                    // Check admin
                    const adminRes = await fetch(`${baseUrl.value}/api/admin/settings`, {
                        headers: { 'Authorization': `Bearer ${token.value}` }
                    });
                    isAdmin.value = adminRes.ok;
                    isAuthenticated.value = true;
                    await fetchEmails();
                } else {
                    clearAuth();
                    await checkAdminSetup();
                }
            } catch {
                clearAuth();
                await checkAdminSetup();
            }
        };

        const checkAdminSetup = async () => {
            try {
                const res = await fetch(`${baseUrl.value}/api/admin/check`);
                const data = await res.json();
                showSetup.value = !data.admin_exists;
            } catch {
                showSetup.value = false;
            }
        };

        const clearAuth = () => {
            token.value = '';
            currentUser.value = '';
            isAdmin.value = false;
            localStorage.removeItem('cf_mail_token');
            localStorage.removeItem('cf_mail_user');
        };

        // ===== Setup (first-run) =====

        const setupAdmin = async () => {
            setupLoading.value = true;
            setupResult.value = null;
            try {
                const res = await fetch(`${baseUrl.value}/api/admin/setup`, { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    setupResult.value = data;
                } else {
                    throw new Error(data.error || '初始化失败');
                }
            } catch (err) {
                errorMessage.value = '初始化失败: ' + err.message;
            } finally {
                setupLoading.value = false;
                refreshIcons();
            }
        };

        // ===== Auth =====

        const showErrorInline = (msg) => {
            errorMessage.value = msg;
        };

        const handleLogin = async () => {
            if (configError.value) {
                showErrorInline(configErrorMessage.value);
                return;
            }

            loading.value = true;
            errorMessage.value = '';
            try {
                const res = await fetch(`${baseUrl.value}/api/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(loginForm.value)
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok) {
                    throw new Error(data.error || data.message || `HTTP ${res.status}`);
                }

                token.value = data.token;
                currentUser.value = loginForm.value.username;
                isAdmin.value = data.role === 'admin';

                localStorage.setItem('cf_mail_token', token.value);
                localStorage.setItem('cf_mail_user', currentUser.value);

                isAuthenticated.value = true;
                await fetchMailboxes();
                await fetchEmails();
            } catch (err) {
                showErrorInline('登录失败: ' + err.message);
            } finally {
                loading.value = false;
                refreshIcons();
            }
        };

        const handleRegister = async () => {
            loading.value = true;
            errorMessage.value = '';
            try {
                const res = await fetch(`${baseUrl.value}/api/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(registerForm.value)
                });
                const data = await res.json().catch(() => ({}));

                if (data.ok) {
                    showRegister.value = false;
                    loginForm.value.username = registerForm.value.username;
                    registerForm.value = { username: '', password: '' };
                } else {
                    throw new Error(data.error || '注册失败');
                }
            } catch (err) {
                showErrorInline('注册失败: ' + err.message);
            } finally {
                loading.value = false;
            }
        };

        const handleLogout = () => {
            clearAuth();
            isAuthenticated.value = false;
            selectedEmail.value = null;
            emails.value = [];
            mailboxes.value = [];
            selectedMailbox.value = '';
            showAdmin.value = false;
            errorMessage.value = '';
            showSetup.value = false;
        };

        // ===== Mailboxes =====

        const fetchMailboxes = async () => {
            try {
                const res = await fetch(`${baseUrl.value}/api/mailboxes`, {
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    mailboxes.value = data.mailboxes || [];
                    if (mailboxes.value.length > 0 && !selectedMailbox.value) {
                        selectedMailbox.value = mailboxes.value[0].address;
                    }
                }
            } catch (e) {
                console.error('fetch mailboxes error:', e);
            }
        };

        const switchMailbox = (address) => {
            selectedMailbox.value = address;
            selectedEmail.value = null;
            fetchEmails();
        };

        const generateMailbox = async () => {
            try {
                const res = await fetch(`${baseUrl.value}/api/generate`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                const data = await res.json();
                if (data.email) {
                    await fetchMailboxes();
                    selectedMailbox.value = data.email;
                    selectedEmail.value = null;
                    await fetchEmails();
                }
            } catch (e) {
                showErrorInline('生成邮箱失败: ' + e.message);
            }
        };

        // ===== Emails =====

        const fetchEmails = async () => {
            if (!isAuthenticated.value || !currentMailbox.value) return;

            loadingEmails.value = true;
            try {
                let url;
                if (currentFolder.value === 'sent') {
                    url = `${baseUrl.value}/api/sent?from=${encodeURIComponent(currentMailbox.value)}`;
                } else {
                    url = `${baseUrl.value}/api/emails?mailbox=${encodeURIComponent(currentMailbox.value)}`;
                }

                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                const data = await res.json().catch(() => null);

                if (!res.ok) {
                    throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
                }

                if (currentFolder.value === 'sent') {
                    emails.value = (data && data.sent) ? data.sent : [];
                } else {
                    emails.value = (data && data.emails) ? data.emails : [];
                }
            } catch (e) {
                console.error('fetch emails error:', e);
                showErrorInline('获取邮件失败: ' + e.message);
                emails.value = [];
            } finally {
                loadingEmails.value = false;
                refreshIcons();
            }
        };

        const selectEmail = async (mail) => {
            selectedEmail.value = { ...mail };
            viewMode.value = 'rendered';
            loadingDetail.value = true;

            try {
                const endpoint = currentFolder.value === 'sent' ? `/api/sent/${mail.id}` : `/api/email/${mail.id}`;
                const res = await fetch(`${baseUrl.value}${endpoint}`, {
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    const mailObj = data.email || data.sent || {};
                    selectedEmail.value = { ...mail, ...mailObj };
                }
            } catch (e) {
                console.error('load detail error:', e);
            } finally {
                loadingDetail.value = false;
                refreshIcons();
            }
        };

        const deleteEmail = async (id) => {
            if (!confirm('确定要删除这封邮件吗？')) return;
            try {
                const endpoint = currentFolder.value === 'sent' ? `/api/sent/${id}` : `/api/email/${id}`;
                const res = await fetch(`${baseUrl.value}${endpoint}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || '删除失败');
                }
                selectedEmail.value = null;
                fetchEmails();
            } catch (err) {
                showErrorInline('删除失败: ' + err.message);
            }
        };

        const filteredEmails = computed(() => {
            if (!searchQuery.value) return emails.value;
            const q = searchQuery.value.toLowerCase();
            return emails.value.filter(e =>
                (e.subject && e.subject.toLowerCase().includes(q)) ||
                (e.sender && e.sender.toLowerCase().includes(q)) ||
                (e.from_addr && e.from_addr.toLowerCase().includes(q))
            );
        });

        // ===== Composer =====

        const openComposer = (type = 'new') => {
            if (type === 'reply' && selectedEmail.value) {
                composerForm.value = {
                    to: selectedEmail.value.sender || selectedEmail.value.from_addr,
                    subject: `Re: ${selectedEmail.value.subject}`,
                    body: `\n\n--- 原始邮件 ---\n${selectedEmail.value.text || selectedEmail.value.preview || ''}`,
                    html: ''
                };
            } else if (type === 'forward' && selectedEmail.value) {
                composerForm.value = {
                    to: '',
                    subject: `Fwd: ${selectedEmail.value.subject}`,
                    body: `\n\n--- 转发邮件 ---\n发件人: ${selectedEmail.value.sender || selectedEmail.value.from_addr}\n${selectedEmail.value.text || selectedEmail.value.preview || ''}`,
                    html: selectedEmail.value.html || ''
                };
            } else {
                composerForm.value = { to: '', subject: '', body: '', html: '' };
            }
            showComposer.value = true;
            refreshIcons();
        };

        const sendEmail = async () => {
            sending.value = true;
            errorMessage.value = '';
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
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token.value}`
                    },
                    body: JSON.stringify(payload)
                });
                const data = await res.json().catch(() => ({}));

                if (res.ok) {
                    showComposer.value = false;
                    if (currentFolder.value === 'sent') fetchEmails();
                } else {
                    throw new Error(data.error || '发送失败');
                }
            } catch (err) {
                showErrorInline('发送失败: ' + err.message);
            } finally {
                sending.value = false;
            }
        };

        // ===== Admin =====

        const openAdmin = async () => {
            showAdmin.value = true;
            errorMessage.value = '';
            try {
                const [settingsRes, usersRes] = await Promise.all([
                    fetch(`${baseUrl.value}/api/admin/settings`, {
                        headers: { 'Authorization': `Bearer ${token.value}` }
                    }),
                    fetch(`${baseUrl.value}/api/admin/users`, {
                        headers: { 'Authorization': `Bearer ${token.value}` }
                    })
                ]);
                const sData = await settingsRes.json();
                adminSettings.value = sData.settings || {};
                const uData = await usersRes.json();
                adminUsers.value = uData.users || [];
            } catch (e) {
                showErrorInline('加载管理面板失败: ' + e.message);
            }
            refreshIcons();
        };

        const closeAdmin = () => {
            showAdmin.value = false;
        };

        const toggleRegistration = async () => {
            const newVal = adminSettings.value.allow_registration === 'true' ? 'false' : 'true';
            try {
                const res = await fetch(`${baseUrl.value}/api/admin/settings`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
                    body: JSON.stringify({ key: 'allow_registration', value: newVal })
                });
                const data = await res.json();
                if (data.ok) {
                    adminSettings.value.allow_registration = newVal;
                }
            } catch (e) {
                showErrorInline('更新失败: ' + e.message);
            }
        };

        const updateSendLimit = () => {
            const val = adminSettings.value.daily_send_limit;
            fetch(`${baseUrl.value}/api/admin/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
                body: JSON.stringify({ key: 'daily_send_limit', value: String(val) })
            }).then(r => r.json()).then(d => {
                if (!d.ok) showErrorInline('更新失败');
            }).catch(e => showErrorInline('更新失败: ' + e.message));
        };

        // ===== Utils =====

        const formatDate = (d) => {
            if (!d) return '';
            return d.split(' ')[0] || d;
        };

        const sanitizedContent = computed(() => {
            const html = selectedEmail.value?.html || selectedEmail.value?.text || '';
            return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
        });

        const refreshIcons = () => {
            nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
        };

        onMounted(() => { loadConfig(); });

        return {
            isAuthenticated, loading, loadingEmails, loadingDetail, sending,
            configError, configErrorMessage, baseUrl, token, currentUser, isAdmin,
            loginForm, registerForm, showRegister, errorMessage,
            showSetup, setupLoading, setupResult,
            mailboxes, selectedMailbox,
            currentFolder, searchQuery, selectedEmail, viewMode, emails,
            showComposer, composerEditMode, composerForm,
            showAdmin, adminSettings, adminUsers,
            navFolders, currentMailbox, filteredEmails,
            handleLogin, handleRegister, handleLogout, setupAdmin,
            fetchMailboxes, switchMailbox, generateMailbox,
            selectEmail, deleteEmail, fetchEmails,
            openComposer, sendEmail,
            openAdmin, closeAdmin, toggleRegistration, updateSendLimit,
            formatDate, sanitizedContent
        };
    }
}).mount('#app');