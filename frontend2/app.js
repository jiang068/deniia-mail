const { createApp, ref, computed, onMounted, onUnmounted, nextTick } = Vue;

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
        const showMailboxDialog = ref(false);
        const mailboxCustomName = ref('');
        const quota = ref({ limit: 3, used: 0, remaining: 3 });

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
        const adminSettings = ref({ allow_registration: 'false', daily_send_limit: '50', default_mailbox_limit: '3' });
        const adminUsers = ref([]);

        // ===== Cache =====
        const emailDetailCache = new Map(); // key: "${type}-${id}" → detail object
        const emailListCache = new Map();   // key: "${mailbox}|${folder}" → { data, timestamp }
        const LIST_CACHE_TTL = 15000;        // 15 seconds

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
                    const adminRes = await fetch(`${baseUrl.value}/api/admin/settings`, {
                        headers: { 'Authorization': `Bearer ${token.value}` }
                    });
                    isAdmin.value = adminRes.ok;
                    isAuthenticated.value = true;
                    await fetchQuota();
                    await fetchEmails();
                    startStatusPolling();
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

                emailDetailCache.clear();
                emailListCache.clear();

                isAuthenticated.value = true;
                await fetchMailboxes();
                await fetchQuota();
                await fetchEmails();
                startStatusPolling();
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
            emailDetailCache.clear();
            emailListCache.clear();
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

        const fetchQuota = async () => {
            try {
                const res = await fetch(`${baseUrl.value}/api/user/quota`, {
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                if (res.ok) {
                    quota.value = await res.json();
                }
            } catch (e) {
                console.error('fetch quota error:', e);
            }
        };

        const openMailboxDialog = async () => {
            await fetchQuota();
            if (!isAdmin.value && quota.value.remaining <= 0) {
                showErrorInline('邮箱数量已达上限（' + quota.value.limit + ' 个）');
                return;
            }
            mailboxCustomName.value = '';
            showMailboxDialog.value = true;
            refreshIcons();
        };

        const createRandomMailbox = async () => {
            try {
                const res = await fetch(`${baseUrl.value}/api/generate`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                const data = await res.json();
                if (data.email) {
                    showMailboxDialog.value = false;
                    emailListCache.clear();
                    await fetchMailboxes();
                    await fetchQuota();
                    selectedMailbox.value = data.email;
                    selectedEmail.value = null;
                    await fetchEmails();
                }
            } catch (e) {
                showErrorInline('生成失败: ' + e.message);
            }
        };

        const createCustomMailbox = async () => {
            const name = mailboxCustomName.value.trim().toLowerCase();
            if (!name || !/^[a-z0-9._-]{1,64}$/.test(name)) {
                showErrorInline('名称只能包含小写字母、数字、.-_（最长 64 位）');
                return;
            }
            try {
                const res = await fetch(`${baseUrl.value}/api/create`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
                    body: JSON.stringify({ local: name })
                });
                const data = await res.json();
                if (data.email) {
                    showMailboxDialog.value = false;
                    emailListCache.clear();
                    await fetchMailboxes();
                    await fetchQuota();
                    selectedMailbox.value = data.email;
                    selectedEmail.value = null;
                    await fetchEmails();
                } else {
                    throw new Error(data.error || '创建失败');
                }
            } catch (e) {
                showErrorInline('创建失败: ' + e.message);
            }
        };

        const switchMailbox = (address) => {
            if (address === selectedMailbox.value) return;
            selectedMailbox.value = address;
            selectedEmail.value = null;
            fetchEmails();
        };

        // ===== Emails =====

        const fetchEmails = async (force = false) => {
            if (!isAuthenticated.value || !currentMailbox.value) return;

            const cacheKey = `${currentMailbox.value}|${currentFolder.value}`;
            const cached = emailListCache.get(cacheKey);

            // Use cache if within TTL and not forced
            if (!force && cached && Date.now() - cached.timestamp < LIST_CACHE_TTL) {
                emails.value = cached.data;
                return;
            }

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

                let list;
                if (currentFolder.value === 'sent') {
                    list = (data && data.sent) ? data.sent : [];
                } else {
                    list = (data && data.emails) ? data.emails : [];
                }
                emails.value = list;
                emailListCache.set(cacheKey, { data: list, timestamp: Date.now() });
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
            const type = currentFolder.value === 'sent' ? 'sent' : 'email';
            const cacheKey = `${type}-${mail.id}`;

            // 切换邮件时重置"加载外链"状态，避免新邮件自动加载远程内容
            remoteContentLevel.value = 0;
            contentRenderTick.value += 1;

            // Cache hit — instant, no loading
            const cached = emailDetailCache.get(cacheKey);
            if (cached) {
                selectedEmail.value = { ...mail, ...cached };
                viewMode.value = 'rendered';
                refreshIcons();
                return;
            }

            // Cache miss — keep old email visible while fetching
            selectedEmail.value = { ...mail };
            viewMode.value = 'rendered';
            loadingDetail.value = true;

            try {
                const endpoint = type === 'sent' ? `/api/sent/${mail.id}` : `/api/email/${mail.id}`;
                const res = await fetch(`${baseUrl.value}${endpoint}`, {
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    const mailObj = data.email || data.sent || {};
                    emailDetailCache.set(cacheKey, mailObj);
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
                const type = currentFolder.value === 'sent' ? 'sent' : 'email';
                const endpoint = type === 'sent' ? `/api/sent/${id}` : `/api/email/${id}`;
                const res = await fetch(`${baseUrl.value}${endpoint}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token.value}` }
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || '删除失败');
                }
                // Invalidate caches
                emailDetailCache.delete(`${type}-${id}`);
                emailListCache.delete(`${currentMailbox.value}|${currentFolder.value}`);
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
                    // Invalidate sent list cache
                    emailListCache.delete(`${currentMailbox.value}|sent`);
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

        const updateDefaultMailboxLimit = () => {
            const val = adminSettings.value.default_mailbox_limit;
            fetch(`${baseUrl.value}/api/admin/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
                body: JSON.stringify({ key: 'default_mailbox_limit', value: String(val) })
            }).then(r => r.json()).then(d => {
                if (!d.ok) showErrorInline('更新失败');
            }).catch(e => showErrorInline('更新失败: ' + e.message));
        };

        // ===== Utils =====

        const formatDate = (d) => {
            if (!d) return '';
            return d.split(' ')[0] || d;
        };

        // ===== 邮件外链内容保护 =====
        // 三级控制：
        //   0 = 拦截全部外链（默认）
        //   1 = 只加载图片外链（其余 CSS/媒体/预加载追踪仍拦）
        //   2 = 加载所有外链（完全信任该邮件）
        const remoteContentLevel = ref(0);
        const contentRenderTick = ref(0); // 强制重算 protectedContent

        // 判定是否为外链 url（https/http 开头，非 data:/cid: 等）
        const isExternalUrl = (src) => {
            return /^https?:\/\//i.test(src);
        };

        // 处理内联样式中的远程 url() 引用（追踪 background-image 等）
        const sanitizeStyleUrls = (styleText, allowRemote) => {
            return styleText.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, url) => {
                const cleanUrl = url.trim();
                if (isExternalUrl(cleanUrl)) {
                    // 外链 url：仅在允许加载时保留，否则移除该声明
                    return allowRemote ? match : 'none';
                }
                return match; // data:/cid:/相对路径等保留
            });
        };

        // 处理邮件 HTML：DOMPurify 清洗 + 按级别拦截外链追踪
        const protectContent = (rawHtml) => {
            let html = rawHtml || '';
            const level = remoteContentLevel.value;
            const allowImages = level >= 1;
            const allowAll = level >= 2;

            // 1. DOMPurify 清洗：剥掉可执行脚本、事件属性、危险元素；保留样式与排版
            if (window.DOMPurify) {
                html = window.DOMPurify.sanitize(html, {
                    ADD_ATTR: ['target', 'data-original-src', 'data-original-srcset', 'data-blocked', 'data-level'],
                    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'],
                    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'autofocus']
                });
            }

            // 2. 解析 DOM 处理外链
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const docBody = doc.body || doc;

            // ---- 图片外链（<img>/<picture> <source>/<input type=image>）----
            // 拦截时移除 src/srcset（浏览器不发起请求），原值存 data-* 便于恢复。
            const imageEls = docBody.querySelectorAll('img, picture source, input[type="image"]');
            imageEls.forEach(el => {
                const src = el.getAttribute('src') || '';
                const srcset = el.getAttribute('srcset') || '';
                const isExtern = isExternalUrl(src) || (srcset && /https?:\/\//i.test(srcset));

                if (!isExtern) return; // 内嵌/本地图不动

                if (allowImages) {
                    // 允许加载：恢复原始 src / srcset
                    const origSrc = el.getAttribute('data-original-src');
                    const origSs = el.getAttribute('data-original-srcset');
                    if (origSrc) el.setAttribute('src', origSrc);
                    if (origSs) el.setAttribute('srcset', origSs);
                    el.removeAttribute('data-blocked');
                    el.removeAttribute('data-original-src');
                    el.removeAttribute('data-original-srcset');
                } else {
                    // 拦截：移除 src/srcset，浏览器不请求
                    if (isExternalUrl(src)) {
                        el.setAttribute('data-original-src', src);
                        el.removeAttribute('src');
                    }
                    if (srcset && /https?:\/\//i.test(srcset)) {
                        el.setAttribute('data-original-srcset', srcset);
                        el.removeAttribute('srcset');
                    }
                    el.setAttribute('data-blocked', '1');
                }
                el.removeAttribute('onerror');
            });
            // 纯 data:/cid: 内嵌图片始终保留
            docBody.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src') || '';
                if (!isExternalUrl(src)) {
                    img.removeAttribute('data-blocked');
                }
            });

            // ---- CSS 内联 style 中的远程 url() ----
            docBody.querySelectorAll('*[style]').forEach(el => {
                const style = el.getAttribute('style') || '';
                if (/url\(/i.test(style) && /https?:\/\//i.test(style)) {
                    el.setAttribute('style', sanitizeStyleUrls(style, allowAll));
                }
            });

            // ---- <style> 标签中的 @import 远程 CSS 与 url() ----
            docBody.querySelectorAll('style').forEach(st => {
                if (allowAll) return; // 完全信任则保留
                const text = st.textContent || '';
                // 移除 @import url(http...)
                let cleaned = text.replace(/@import\s+(?:url\(\s*)?['"]?https?:\/\/[^'")\s;]+/gi, '');
                // 移除 url(http...) 外链引用
                cleaned = cleaned.replace(/url\(\s*['"]?https?:\/\/[^'")\s;]+/gi, 'url()');
                st.textContent = cleaned;
            });

            // ---- 媒体元素外链 <video>/<audio>/<source src>（非图片）----
            docBody.querySelectorAll('video source, audio source').forEach(s => {
                const src = s.getAttribute('src') || '';
                if (isExternalUrl(src) && !allowAll) {
                    s.removeAttribute('src');
                }
            });
            docBody.querySelectorAll('video, audio').forEach(m => {
                if (m.getAttribute('src') && isExternalUrl(m.getAttribute('src')) && !allowAll) {
                    m.removeAttribute('src');
                }
            });

            // ---- <a> 外链：始终新窗口 + noopener（防反向 tabnabbing）----
            // 外链链接仅在用户点击时才由浏览器跳转，无自动请求，始终保留并加安全属性。
            docBody.querySelectorAll('a[href]').forEach(a => {
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer nofollow');
            });

            return docBody.innerHTML;
        };

        const protectedContent = computed(() => {
            // 显式依赖 remoteContentLevel 与 contentRenderTick，切换按钮时强制重算
            void remoteContentLevel.value;
            void contentRenderTick.value;
            const raw = selectedEmail.value?.html || selectedEmail.value?.text || '';
            return protectContent(raw);
        });

        // 检测邮件是否含外链图片（用于显示"加载图片"横幅）
        const hasExternalImages = computed(() => {
            const raw = selectedEmail.value?.html || '';
            return /<img[^>]+(?:https?:)?\/\//i.test(raw) ||
                /<source[^>]+srcset=.*https?:/i.test(raw) ||
                /<input[^>]+type=["']?image[^>]+https?:/i.test(raw);
        });

        // 检测邮件是否含更隐蔽的追踪（CSS/媒体/预加载），超出"仅图片"级别
        const hasAdvancedTrackers = computed(() => {
            const raw = selectedEmail.value?.html || '';
            return /<style[^>]*>[\s\S]*@import/gi.test(raw) ||
                /style=["'][^"']*url\(\s*https?:/i.test(raw) ||
                /<video|<audio/i.test(raw) ||
                /<link[^>]+rel=["']?(?:preload|prefetch)["']?/i.test(raw);
        });

        const toggleRemoteContent = (level) => {
            remoteContentLevel.value = level;
            contentRenderTick.value += 1;
            nextTick(() => refreshIcons());
        };

        const refreshIcons = () => {
            nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
        };

        // ===== 投递状态轮询 =====
        let statusPollTimer = null;

        const pollDeliveryStatus = async () => {
            if (!isAuthenticated.value || !token.value) return;
            try {
                const sentList = emails.value.filter(e => e.delivery_status && e.delivery_status !== 'delivered');
                if (sentList.length === 0) return;

                const ids = sentList.map(e => e.id);
                const res = await fetch(`${baseUrl.value}/api/emails/check-status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
                    body: JSON.stringify({ ids })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.results) {
                        const updates = {};
                        for (const r of data.results) updates[r.id] = r.delivery_status;
                        // Update list
                        emails.value = emails.value.map(e => ({
                            ...e,
                            delivery_status: updates[e.id] || e.delivery_status
                        }));
                        // Update cache if viewing sent folder
                        const cacheKey = `${currentMailbox.value}|${currentFolder.value}`;
                        const cached = emailListCache.get(cacheKey);
                        if (cached) {
                            cached.data = emails.value;
                            cached.timestamp = Date.now();
                        }
                    }
                }
            } catch (e) {
                // silent — polling should not alert the user
            }
        };

        const startStatusPolling = () => {
            stopStatusPolling();
            statusPollTimer = setInterval(pollDeliveryStatus, 15000);
        };

        const stopStatusPolling = () => {
            if (statusPollTimer) {
                clearInterval(statusPollTimer);
                statusPollTimer = null;
            }
        };

        onMounted(() => { loadConfig(); });
        onUnmounted(() => { stopStatusPolling(); });

        return {
            isAuthenticated, loading, loadingEmails, loadingDetail, sending,
            configError, configErrorMessage, baseUrl, token, currentUser, isAdmin,
            loginForm, registerForm, showRegister, errorMessage,
            showSetup, setupLoading, setupResult,
            mailboxes, selectedMailbox, showMailboxDialog, mailboxCustomName, quota,
            currentFolder, searchQuery, selectedEmail, viewMode, emails,
            showComposer, composerEditMode, composerForm,
            showAdmin, adminSettings, adminUsers,
            navFolders, currentMailbox, filteredEmails,
            handleLogin, handleRegister, handleLogout, setupAdmin,
            fetchMailboxes, switchMailbox, openMailboxDialog, createRandomMailbox, createCustomMailbox,
            selectEmail, deleteEmail, fetchEmails,
            openComposer, sendEmail,
            openAdmin, closeAdmin, toggleRegistration, updateSendLimit, updateDefaultMailboxLimit,
            formatDate, protectedContent, hasExternalImages, hasAdvancedTrackers, remoteContentLevel, toggleRemoteContent
        };
    }
}).mount('#app');