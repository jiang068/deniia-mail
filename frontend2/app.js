const { createApp, ref, computed, onMounted, nextTick } = Vue;

createApp({
    setup() {
        const isAuthenticated = ref(false);
        const loading = ref(false);
        const sending = ref(false);
        const configError = ref(false);
        const configErrorMessage = ref('');
        
        const baseUrl = ref('');
        const defaultDomain = ref('deniia.com');
        
        const token = ref(localStorage.getItem('cf_mail_token') || '');
        const currentUser = ref(localStorage.getItem('cf_mail_user') || '');

        const loginForm = ref({ username: '', password: '' });

        const currentFolder = ref('inbox');
        const searchQuery = ref('');
        const selectedEmail = ref(null);
        const viewMode = ref('rendered');
        const showComposer = ref(false);
        const composerEditMode = ref('text');
        const activeModal = ref(null);

        const emails = ref([]);
        const userList = ref([]);
        const newUser = ref('');

        const composerForm = ref({
            to: '',
            subject: '',
            body: '',
            html: ''
        });

        const navFolders = ref([
            { id: 'inbox', label: '收件箱', icon: 'inbox' },
            { id: 'sent', label: '已发送', icon: 'send' },
            { id: 'drafts', label: '草稿箱', icon: 'file-text' },
            { id: 'trash', label: '垃圾箱', icon: 'trash-2' }
        ]);

        // 自动计算完整邮箱地址 (例如: admin_m9mnj4 -> admin_m9mnj4@deniia.com)
        const currentMailbox = computed(() => {
            if (!currentUser.value) return '';
            if (currentUser.value.includes('@')) {
                return currentUser.value;
            }
            const domain = defaultDomain.value || 'deniia.com';
            return `${currentUser.value}@${domain}`;
        });

        // 读取 config.json
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
                if (cfg.defaultDomain) {
                    defaultDomain.value = cfg.defaultDomain.trim();
                }
                configError.value = false;

                if (token.value && currentUser.value) {
                    isAuthenticated.value = true;
                    await fetchEmails();
                }
            } catch (err) {
                console.error('配置检测错误:', err);
                configError.value = true;
                configErrorMessage.value = err.message;
                isAuthenticated.value = false;
            } finally {
                refreshIcons();
            }
        };

        onMounted(() => {
            loadConfig();
        });

        const refreshIcons = () => {
            nextTick(() => {
                if (window.lucide) {
                    window.lucide.createIcons();
                }
            });
        };

        // 登录（使用原始用户名账号进行认证）
        const handleLogin = async () => {
            if (configError.value) {
                alert(configErrorMessage.value);
                return;
            }

            loading.value = true;
            try {
                const response = await fetch(`${baseUrl.value}/api/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(loginForm.value)
                });

                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(data.error || data.message || `HTTP ${response.status}`);
                }

                token.value = data.token || loginForm.value.password;
                currentUser.value = loginForm.value.username;
                
                localStorage.setItem('cf_mail_token', token.value);
                localStorage.setItem('cf_mail_user', currentUser.value);

                isAuthenticated.value = true;
                await fetchEmails();
            } catch (err) {
                console.error('登录失败:', err);
                alert(`登录失败: ${err.message}`);
                isAuthenticated.value = false;
            } finally {
                loading.value = false;
                refreshIcons();
            }
        };

        const handleLogout = () => {
            localStorage.removeItem('cf_mail_token');
            localStorage.removeItem('cf_mail_user');
            token.value = '';
            currentUser.value = '';
            isAuthenticated.value = false;
            selectedEmail.value = null;
            emails.value = [];
        };

        // 拉取邮件列表（使用拼接好的完整邮箱地址）
        const fetchEmails = async () => {
            if (!isAuthenticated.value || !currentMailbox.value) return;

            try {
                const url = `${baseUrl.value}/api/emails?mailbox=${encodeURIComponent(currentMailbox.value)}`;

                const res = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token.value}`
                    }
                });

                const data = await res.json().catch(() => null);

                if (!res.ok) {
                    throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
                }

                emails.value = (data && data.emails) ? data.emails : (Array.isArray(data) ? data : []);
            } catch (e) {
                console.error('获取邮件失败:', e);
                alert(`获取邮件列表失败: ${e.message}`);
                emails.value = [];
            }
            refreshIcons();
        };

        // 选择/查看邮件详情
        const selectEmail = async (mail) => {
            selectedEmail.value = mail;
            viewMode.value = 'rendered';

            try {
                const res = await fetch(`${baseUrl.value}/api/emails/${mail.id}`, {
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                if (res.ok) {
                    const detail = await res.json();
                    selectedEmail.value = { ...mail, ...detail };
                }
            } catch (e) {
                console.log('使用已有列表数据展示邮件');
            }
            refreshIcons();
        };

        const deleteEmail = async (id) => {
            if (!confirm('确定要删除这封邮件吗？')) return;
            try {
                const res = await fetch(`${baseUrl.value}/api/emails/${id}`, {
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
                alert(`删除邮件失败: ${err.message}`);
            }
        };

        const filteredEmails = computed(() => {
            if (!searchQuery.value) return emails.value;
            const q = searchQuery.value.toLowerCase();
            return emails.value.filter(e => 
                (e.subject && e.subject.toLowerCase().includes(q)) || 
                (e.sender && e.sender.toLowerCase().includes(q)) ||
                (e.from && e.from.toLowerCase().includes(q))
            );
        });

        const openComposer = (type = 'new') => {
            if (type === 'reply' && selectedEmail.value) {
                composerForm.value = {
                    to: selectedEmail.value.sender || selectedEmail.value.from,
                    subject: `Re: ${selectedEmail.value.subject}`,
                    body: `\n\n--- 原始邮件 ---\n${selectedEmail.value.text || selectedEmail.value.preview || ''}`,
                    html: ''
                };
            } else if (type === 'forward' && selectedEmail.value) {
                composerForm.value = {
                    to: '',
                    subject: `Fwd: ${selectedEmail.value.subject}`,
                    body: `\n\n--- 转发邮件 ---\n发件人: ${selectedEmail.value.sender || selectedEmail.value.from}\n${selectedEmail.value.text || selectedEmail.value.preview || ''}`,
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
            try {
                const payload = {
                    from: currentMailbox.value,
                    to: composerForm.value.to,
                    subject: composerForm.value.subject,
                    text: composerForm.value.body,
                    html: composerEditMode.value === 'html' ? composerForm.value.html : composerForm.value.body
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
                    alert('邮件发送成功！');
                    showComposer.value = false;
                    fetchEmails();
                } else {
                    throw new Error(data.error || '发送失败');
                }
            } catch (err) {
                alert(`发送异常: ${err.message}`);
            } finally {
                sending.value = false;
            }
        };

        const addUser = () => {
            if (newUser.value && !userList.value.includes(newUser.value)) {
                userList.value.push(newUser.value);
                newUser.value = '';
            }
        };

        const removeUser = (u) => {
            userList.value = userList.value.filter(item => item !== u);
        };

        const formatDate = (d) => {
            if (!d) return '';
            return d.split(' ')[0] || d;
        };

        return {
            isAuthenticated, loading, sending, configError, configErrorMessage, baseUrl, token, currentUser, currentMailbox, loginForm,
            currentFolder, searchQuery, selectedEmail, viewMode, showComposer,
            composerEditMode, activeModal, emails, userList, newUser,
            composerForm, navFolders, filteredEmails, loadConfig, handleLogin, handleLogout,
            selectEmail, openComposer, sendEmail, deleteEmail, fetchEmails, addUser, removeUser, formatDate
        };
    }
}).mount('#app');