/* API_BASE 解析链：
 *   1. localStorage.getItem('deniia_api_base') — 本地开发或 Pages 部署后手动设置
 *   2. 未设置则弹出配置界面引导用户填写
 */
let API = '';

function resolveApiBase() {
  const stored = localStorage.getItem('deniia_api_base');
  if (stored) {
    API = stored.replace(/\/+$/, '') + '/api';
    return true;
  }
  return false;
}

let token = localStorage.getItem('token');
let currentUser = null;
let mailboxes = [];
let currentMailbox = null;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ======================== Config prompt ========================

function showConfigPrompt() {
  document.getElementById('config-overlay').classList.remove('hidden');
  document.getElementById('config-url').focus();
}

function saveConfig() {
  const url = document.getElementById('config-url').value.trim().replace(/\/+$/, '');
  if (!url || !url.startsWith('http')) {
    document.getElementById('config-error').textContent = 'Please enter a valid URL starting with http:// or https://';
    document.getElementById('config-error').classList.remove('hidden');
    return;
  }
  localStorage.setItem('deniia_api_base', url);
  document.getElementById('config-overlay').classList.add('hidden');
  API = url + '/api';
  init();
}

// ======================== Auth ========================

async function login() {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const { status, data } = await api('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  if (data.token) {
    token = data.token;
    currentUser = { role: data.role, can_send: data.can_send, mailbox_limit: data.mailbox_limit };
    localStorage.setItem('token', token);
    await showMailView();
  } else {
    showError(data.error || 'Login failed');
  }
}

async function register() {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const { data } = await api('/register', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  if (data.ok) {
    alert(`Registered! Your email: ${data.email}. Now login.`);
  } else {
    showError(data.error || 'Registration failed');
  }
}

function logout() {
  token = null;
  currentUser = null;
  mailboxes = [];
  currentMailbox = null;
  localStorage.removeItem('token');
  showAuthView();
}

// ======================== Admin Setup ========================

async function setupAdmin() {
  const btn = document.getElementById('setup-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  const { status, data } = await api('/admin/setup', { method: 'POST' });
  if (data.ok) {
    document.getElementById('setup-result').classList.remove('hidden');
    document.getElementById('setup-username').textContent = data.username;
    document.getElementById('setup-password').textContent = data.password;
    document.getElementById('setup-email').textContent = data.email;
    btn.textContent = 'Created';
  } else {
    alert('Setup failed: ' + (data.error || 'unknown error'));
    btn.disabled = false;
    btn.textContent = 'Initialize Admin';
  }
}

// ======================== Views ========================

function showError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showAuthView() {
  document.getElementById('auth-view').classList.remove('hidden');
  document.getElementById('mail-view').classList.add('hidden');
  document.getElementById('admin-view')?.classList.add('hidden');
}

async function showMailView() {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('mail-view').classList.remove('hidden');
  document.getElementById('admin-view')?.classList.add('hidden');

  const adminBtn = document.getElementById('admin-btn');
  if (adminBtn) {
    adminBtn.classList.toggle('hidden', !currentUser || currentUser.role !== 'admin');
  }

  const { data: mbData } = await api('/mailboxes');
  mailboxes = mbData.mailboxes || [];
  if (mailboxes.length === 0) {
    const { data: genData } = await api('/generate');
    if (genData.email) {
      mailboxes = [{ address: genData.email }];
    }
  }

  currentMailbox = mailboxes[0]?.address || null;

  const emailEl = document.getElementById('user-email');
  if (emailEl) emailEl.textContent = currentMailbox || '';

  renderMailboxList();
  await loadEmails();
}

function renderMailboxList() {
  const container = document.getElementById('mailbox-list');
  if (!container) return;
  container.innerHTML = (mailboxes || []).map(mb => `
    <div class="p-2 ${mb.address === currentMailbox ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-gray-50'} rounded-lg cursor-pointer text-sm truncate"
         onclick="switchMailbox('${esc(mb.address)}')">
      ${esc(mb.address)}
    </div>
  `).join('');
}

async function switchMailbox(address) {
  currentMailbox = address;
  renderMailboxList();
  document.getElementById('user-email').textContent = address || '';
  await loadEmails();
}

async function loadEmails() {
  const list = document.getElementById('email-list');
  if (!currentMailbox) {
    list.innerHTML = '<div class="p-6 text-center text-gray-400">No mailbox available</div>';
    return;
  }

  list.innerHTML = '<div class="p-6 text-center text-gray-400">Loading...</div>';
  const { data } = await api('/emails?mailbox=' + encodeURIComponent(currentMailbox));
  if (data.emails?.length) {
    list.innerHTML = data.emails.map(e => `
      <div class="border-b p-4 hover:bg-gray-50 cursor-pointer" onclick="openEmail(${e.id})">
        <div class="flex items-center gap-2">
          ${e.is_read ? '' : '<span class="w-2 h-2 bg-blue-500 rounded-full shrink-0"></span>'}
          <span class="font-medium ${e.is_read ? '' : 'text-blue-700'}">${esc(e.subject)}</span>
        </div>
        <div class="text-sm text-gray-500">${esc(e.sender)}</div>
        <div class="text-xs text-gray-400">${e.received_at || e.created_at}</div>
      </div>
    `).join('');
  } else {
    list.innerHTML = '<div class="p-6 text-center text-gray-400">No emails yet</div>';
  }
}

async function openEmail(id) {
  const { data } = await api('/email/' + id);
  if (data.email) {
    const e = data.email;
    alert(`From: ${e.sender}\nTo: ${e.to_addrs}\nSubject: ${e.subject}\n\n${e.raw_content || '(no content)'}`);
    await loadEmails();
  }
}

// ======================== Compose ========================

function compose() {
  document.getElementById('compose-modal').classList.remove('hidden');
  document.getElementById('compose-to').value = '';
  document.getElementById('compose-subject').value = '';
  document.getElementById('compose-body').value = '';
  document.getElementById('compose-error').classList.add('hidden');
  document.getElementById('send-btn').disabled = false;
  document.getElementById('send-btn').textContent = 'Send';
}

function closeCompose() {
  document.getElementById('compose-modal').classList.add('hidden');
}

async function sendEmail() {
  const to = document.getElementById('compose-to').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  const text = document.getElementById('compose-body').value.trim();
  const errEl = document.getElementById('compose-error');
  const btn = document.getElementById('send-btn');

  if (!to || !subject || !text) {
    errEl.textContent = 'All fields are required';
    errEl.classList.remove('hidden');
    return;
  }

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const { status, data } = await api('/send', {
    method: 'POST',
    body: JSON.stringify({
      to,
      subject,
      text,
      from: currentMailbox,
    }),
  });

  if (data.ok) {
    btn.textContent = 'Sent!';
    setTimeout(closeCompose, 1000);
  } else {
    errEl.textContent = data.error || 'Send failed';
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Send';
  }
}

// ======================== Admin Panel ========================

async function showAdminPanel() {
  document.getElementById('mail-view').classList.add('hidden');
  const panel = document.getElementById('admin-view');
  panel.classList.remove('hidden');

  const { data: settingsData } = await api('/admin/settings');
  const s = settingsData.settings || {};

  const regToggle = document.getElementById('reg-toggle');
  const regStatus = document.getElementById('reg-status');
  const isOpen = s.allow_registration === 'true';
  regToggle.checked = isOpen;
  regStatus.textContent = isOpen ? 'Open' : 'Closed';

  const limitInput = document.getElementById('send-limit-input');
  limitInput.value = s.daily_send_limit || '50';

  const { data: usersData } = await api('/admin/users');
  const tbody = document.getElementById('users-tbody');
  if (usersData.users?.length) {
    tbody.innerHTML = usersData.users.map(u => `
      <tr class="border-b">
        <td class="p-2">${esc(u.username)}</td>
        <td class="p-2 text-sm text-gray-500">${esc(u.email_address)}</td>
        <td class="p-2">${u.role === 'admin' ? '<span class="text-yellow-600">Admin</span>' : 'User'}</td>
        <td class="p-2 text-sm text-gray-400">${u.created_at}</td>
      </tr>
    `).join('');
  } else {
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400">No users</td></tr>';
  }
}

async function toggleRegistration() {
  const toggle = document.getElementById('reg-toggle');
  const newValue = toggle.checked ? 'true' : 'false';
  const { data } = await api('/admin/settings', {
    method: 'PUT',
    body: JSON.stringify({ key: 'allow_registration', value: newValue })
  });
  if (data.ok) {
    document.getElementById('reg-status').textContent = toggle.checked ? 'Open' : 'Closed';
  } else {
    toggle.checked = !toggle.checked;
    alert('Failed to update');
  }
}

async function updateSendLimit() {
  const input = document.getElementById('send-limit-input');
  const value = String(parseInt(input.value, 10) || 50);
  const { data } = await api('/admin/settings', {
    method: 'PUT',
    body: JSON.stringify({ key: 'daily_send_limit', value })
  });
  if (data.ok) {
    alert('Send limit updated to ' + value);
  } else {
    alert('Failed to update');
  }
}

// ======================== Reconfigure ========================

function showSettings() {
  document.getElementById('settings-overlay').classList.remove('hidden');
  document.getElementById('settings-url').value = localStorage.getItem('deniia_api_base') || '';
}

function saveSettings() {
  const url = document.getElementById('settings-url').value.trim().replace(/\/+$/, '');
  if (url && url.startsWith('http')) {
    localStorage.setItem('deniia_api_base', url);
    API = url + '/api';
  }
  document.getElementById('settings-overlay').classList.add('hidden');
  location.reload();
}

// ======================== Utils ========================

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ======================== Init ========================

async function init() {
  if (!resolveApiBase()) {
    showConfigPrompt();
    return;
  }

  if (token) {
    const res = await fetch(API + '/mailboxes', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const adminRes = await fetch(API + '/admin/settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      currentUser = { role: adminRes.ok ? 'admin' : 'user' };
      await showMailView();
      return;
    }
    token = null;
    localStorage.removeItem('token');
  }

  const { data } = await api('/admin/check');
  if (!data.admin_exists) {
    document.getElementById('setup-view').classList.remove('hidden');
  } else {
    document.getElementById('setup-view').classList.add('hidden');
  }
}

init();