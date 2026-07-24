import PostalMime from 'postal-mime';

/* ============================================================
 *  Deniia Mail — Cloudflare Worker
 *  入口：fetch（HTTP API）+ email（邮件接收）
 *  ============================================================ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    try {
      // ========== 公开路由 ==========
      if (path === '/api/admin/check' && method === 'GET') {
        return cors(await handleAdminCheck(env));
      }
      if (path === '/api/admin/setup' && method === 'POST') {
        return cors(await handleAdminSetup(env));
      }
      if (path === '/api/register' && method === 'POST') {
        return cors(await handleRegister(request, env));
      }
      if (path === '/api/login' && method === 'POST') {
        return cors(await handleLogin(request, env));
      }
      if (path === '/api/domains' && method === 'GET') {
        return cors(json({ domains: [env.DOMAIN] }));
      }

      // ========== 需要认证的路由 ==========
      const user = await authenticate(request, env);
      if (!user) return cors(json({ error: 'Unauthorized' }, 401));

      // -- 管理后台 --
      if (path.startsWith('/api/admin/')) {
        if (!user.is_admin) return cors(json({ error: 'Forbidden' }, 403));
        return cors(await handleAdminRoutes(request, env, path, method, url, user));
      }

      // -- 前台 API --
      return cors(await handleUserRoutes(request, env, path, method, url, user));
    } catch (err) {
      console.error('Unhandled error:', err);
      return cors(json({ error: 'Internal Server Error' }, 500));
    }
  },

  /* ==================== 邮件接收 ==================== */
  async email(message, env, ctx) {
    try {
      const rawText = await new Response(message.raw).text();
      const parsed = await PostalMime.parse(rawText);

      const rawRecipients = Array.isArray(message.to) ? message.to : [message.to];
      const recipients = rawRecipients.map(r => (typeof r === 'string' ? r : r?.address || r));

      for (const toAddr of recipients) {
        if (!toAddr) continue;
        const cleanTo = toAddr.toLowerCase().trim();

        // 查找收件邮箱
        const mailbox = await env.DB.prepare(
          'SELECT id, forward_to FROM mailboxes WHERE address = ?'
        ).bind(cleanTo).first();

        if (!mailbox) {
          console.log(`[Email] 未找到邮箱 ${cleanTo}，跳过入库`);
          continue;
        }

        const subject = parsed.subject || '(No Subject)';
        const preview = parsed.text
          ? parsed.text.slice(0, 200).replace(/\s+/g, ' ')
          : '';

        // 截断原始内容防止 D1 撑爆
        const maxRaw = 500000;
        const safeRaw = rawText.length > maxRaw
          ? rawText.slice(0, maxRaw) + '\n...[truncated]'
          : rawText;

        await env.DB.prepare(
          `INSERT INTO messages (mailbox_id, sender, to_addrs, subject, preview, raw_content, verification_code)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          mailbox.id,
          parsed.from?.address || message.from || '',
          cleanTo,
          subject,
          preview || null,
          safeRaw,
          null
        ).run();

        console.log(`[Email] 已保存到 ${cleanTo} 的收件箱`);
      }
    } catch (err) {
      console.error('[Email Failed]', err);
    }
  },
};

/* ============================================================
 *  Admin Routes
 *  ============================================================ */

async function handleAdminRoutes(request, env, path, method, url, user) {
  // GET /api/admin/settings
  if (path === '/api/admin/settings' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT key, value FROM settings').all();
    const s = {};
    for (const r of rows.results) s[r.key] = r.value;
    return json({ settings: s });
  }

  // PUT /api/admin/settings
  if (path === '/api/admin/settings' && method === 'PUT') {
    const body = await request.json();
    const allowed = ['allow_registration', 'daily_send_limit'];
    if (!body.key || !allowed.includes(body.key)) {
      return json({ error: 'Invalid setting key' }, 400);
    }
    await env.DB.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).bind(body.key, String(body.value)).run();
    return json({ ok: true });
  }

  // GET /api/admin/users
  if (path === '/api/admin/users' && method === 'GET') {
    const sort = url.searchParams.get('sort') || 'desc';
    const rows = await env.DB.prepare(
      `SELECT u.id, u.username, u.email_address, u.role, u.can_send, u.mailbox_limit, u.created_at,
              (SELECT COUNT(*) FROM user_mailboxes WHERE user_id = u.id) AS mailbox_count
       FROM users u ORDER BY u.created_at ${sort === 'asc' ? 'ASC' : 'DESC'}`
    ).all();
    return json({ users: rows.results });
  }

  // POST /api/admin/users — 管理员创建用户
  if (path === '/api/admin/users' && method === 'POST') {
    const body = await request.json();
    const username = String(body.username || '').trim().toLowerCase();
    if (!username) return json({ error: 'Username required' }, 400);
    if (!body.password || body.password.length < 6) {
      return json({ error: 'Password must be at least 6 characters' }, 400);
    }

    const emailAddress = `${username}@${env.DOMAIN}`.toLowerCase();
    const passwordHash = await sha256(body.password);
    const role = body.role === 'admin' ? 'admin' : 'user';
    const canSend = body.can_send !== false ? 1 : 0;
    const mailboxLimit = parseInt(body.mailbox_limit, 10) || 10;

    try {
      const result = await env.DB.prepare(
        'INSERT INTO users (username, password_hash, email_address, role, can_send, mailbox_limit) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(username, passwordHash, emailAddress, role, canSend, mailboxLimit).run();

      const userId = result.meta.last_row_id;

      // 自动创建默认邮箱
      const localPart = username;
      await env.DB.prepare(
        'INSERT OR IGNORE INTO mailboxes (address, local_part, domain, can_login) VALUES (?, ?, ?, 1)'
      ).bind(emailAddress, localPart, env.DOMAIN).run();

      const mb = await env.DB.prepare(
        'SELECT id FROM mailboxes WHERE address = ?'
      ).bind(emailAddress).first();
      if (mb) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO user_mailboxes (user_id, mailbox_id) VALUES (?, ?)'
        ).bind(userId, mb.id).run();
      }

      return json({ ok: true, id: userId, username, email: emailAddress, role }, 201);
    } catch (err) {
      if (err.message?.includes('UNIQUE')) return json({ error: 'Username already exists' }, 409);
      throw err;
    }
  }

  // PATCH /api/admin/users/:id
  const patchMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
  if (patchMatch && method === 'PATCH') {
    const id = parseInt(patchMatch[1], 10);
    const body = await request.json();
    const updates = [];
    const params = [];

    if (body.role) { updates.push('role = ?'); params.push(body.role === 'admin' ? 'admin' : 'user'); }
    if (body.can_send !== undefined) { updates.push('can_send = ?'); params.push(body.can_send ? 1 : 0); }
    if (body.mailbox_limit !== undefined) { updates.push('mailbox_limit = ?'); params.push(parseInt(body.mailbox_limit, 10) || 10); }
    if (body.password) {
      updates.push('password_hash = ?');
      params.push(await sha256(body.password));
    }

    if (updates.length === 0) return json({ error: 'No fields to update' }, 400);
    params.push(id);
    await env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...params).run();
    return json({ ok: true });
  }

  // DELETE /api/admin/users/:id
  const deleteMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
  if (deleteMatch && method === 'DELETE') {
    const id = parseInt(deleteMatch[1], 10);
    if (id === user.id) return json({ error: 'Cannot delete yourself' }, 400);
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  // POST /api/admin/users/assign
  if (path === '/api/admin/users/assign' && method === 'POST') {
    const body = await request.json();
    const address = String(body.address || '').trim().toLowerCase();
    const username = String(body.username || '').trim().toLowerCase();
    if (!address || !username) return json({ error: 'address and username required' }, 400);

    const userRow = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (!userRow) return json({ error: 'User not found' }, 404);

    const localPart = address.split('@')[0] || address;
    await env.DB.prepare(
      'INSERT OR IGNORE INTO mailboxes (address, local_part, domain, can_login) VALUES (?, ?, ?, 1)'
    ).bind(address, localPart, env.DOMAIN).run();

    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).first();
    if (!mb) return json({ error: 'Failed to create mailbox' }, 500);

    try {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO user_mailboxes (user_id, mailbox_id) VALUES (?, ?)'
      ).bind(userRow.id, mb.id).run();
      return json({ ok: true });
    } catch (err) {
      return json({ error: 'Assignment failed' }, 500);
    }
  }

  // POST /api/admin/users/unassign
  if (path === '/api/admin/users/unassign' && method === 'POST') {
    const body = await request.json();
    const address = String(body.address || '').trim().toLowerCase();
    const username = String(body.username || '').trim().toLowerCase();

    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).first();
    if (!mb) return json({ error: 'Mailbox not found' }, 404);
    const userRow = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (!userRow) return json({ error: 'User not found' }, 404);

    await env.DB.prepare(
      'DELETE FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ?'
    ).bind(userRow.id, mb.id).run();
    return json({ ok: true });
  }

  return json({ error: 'Not Found' }, 404);
}

/* ============================================================
 *  User Routes (Authenticated)
 *  ============================================================ */

async function handleUserRoutes(request, env, path, method, url, user) {
  // ======== 邮件相关 ========

  // GET /api/emails?mailbox=xxx
  if (path === '/api/emails' && method === 'GET') {
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) return json({ error: 'mailbox parameter required' }, 400);

    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?')
      .bind(mailbox.toLowerCase()).first();
    if (!mb) return json({ emails: [] });
    if (!(await canAccessMailbox(env, user, mb.id))) {
      return json({ error: 'Forbidden' }, 403);
    }

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
    const rows = await env.DB.prepare(
      `SELECT id, sender, to_addrs, subject, preview, received_at, is_read, verification_code
       FROM messages WHERE mailbox_id = ?
       ORDER BY received_at DESC LIMIT ?`
    ).bind(mb.id, limit).all();
    return json({ emails: rows.results || [] });
  }

  // GET /api/email/:id
  const emailDetail = path.match(/^\/api\/email\/(\d+)$/);
  if (emailDetail && method === 'GET') {
    const emailId = parseInt(emailDetail[1], 10);
    const msg = await env.DB.prepare(
      'SELECT m.*, mb.address AS mailbox_address FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE m.id = ?'
    ).bind(emailId).first();
    if (!msg) return json({ error: 'Not Found' }, 404);
    if (!(await canAccessMailbox(env, user, msg.mailbox_id))) {
      return json({ error: 'Forbidden' }, 403);
    }

    await env.DB.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').bind(emailId).run();
    return json({ email: msg });
  }

  // DELETE /api/email/:id
  if (emailDetail && method === 'DELETE') {
    const emailId = parseInt(emailDetail[1], 10);
    const msg = await env.DB.prepare('SELECT mailbox_id FROM messages WHERE id = ?').bind(emailId).first();
    if (!msg) return json({ error: 'Not Found' }, 404);
    if (!(await canAccessMailbox(env, user, msg.mailbox_id))) {
      return json({ error: 'Forbidden' }, 403);
    }
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(emailId).run();
    return json({ ok: true });
  }

  // DELETE /api/emails?mailbox=xxx — 清空邮箱
  if (path === '/api/emails' && method === 'DELETE') {
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) return json({ error: 'mailbox parameter required' }, 400);
    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?')
      .bind(mailbox.toLowerCase()).first();
    if (!mb) return json({ ok: true, deleted: 0 });
    if (!(await canAccessMailbox(env, user, mb.id))) {
      return json({ error: 'Forbidden' }, 403);
    }
    const result = await env.DB.prepare('DELETE FROM messages WHERE mailbox_id = ?').bind(mb.id).run();
    return json({ ok: true, deleted: result.meta?.changes || 0 });
  }

  // ======== 邮箱管理 ========

  // GET /api/mailboxes — 用户自己的邮箱列表
  if (path === '/api/mailboxes' && method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT m.id, m.address, m.created_at, um.is_pinned, m.is_favorite, m.forward_to,
              CASE WHEN (SELECT COUNT(*) FROM messages WHERE mailbox_id = m.id AND is_read = 0) > 0 THEN 1 ELSE 0 END AS has_unread
       FROM user_mailboxes um
       JOIN mailboxes m ON m.id = um.mailbox_id
       WHERE um.user_id = ?
       ORDER BY um.is_pinned DESC, m.created_at DESC`
    ).bind(user.id).all();
    return json({ mailboxes: rows.results || [] });
  }

  // GET /api/mailbox/info?address=xxx
  if (path === '/api/mailbox/info' && method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address) return json({ error: 'address required' }, 400);
    const mb = await env.DB.prepare(
      'SELECT id, address, is_favorite, forward_to FROM mailboxes WHERE address = ?'
    ).bind(address.toLowerCase()).first();
    if (!mb) return json({ exists: false });
    if (!(await canAccessMailbox(env, user, mb.id))) return json({ error: 'Forbidden' }, 403);
    return json({ id: mb.id, address: mb.address, is_favorite: !!mb.is_favorite, forward_to: mb.forward_to });
  }

  // POST /api/mailbox/forward — 设置转发
  if (path === '/api/mailbox/forward' && method === 'POST') {
    const body = await request.json();
    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE id = ?')
      .bind(body.mailbox_id).first();
    if (!mb) return json({ error: 'Mailbox not found' }, 404);
    if (!(await canAccessMailbox(env, user, mb.id))) return json({ error: 'Forbidden' }, 403);

    const forwardTo = body.forward_to ? String(body.forward_to).trim() : null;
    if (forwardTo && !forwardTo.includes('@')) return json({ error: 'Invalid forward target' }, 400);

    await env.DB.prepare('UPDATE mailboxes SET forward_to = ? WHERE id = ?')
      .bind(forwardTo, mb.id).run();
    return json({ ok: true, forward_to: forwardTo });
  }

  // POST /api/mailbox/favorite — 切换收藏
  if (path === '/api/mailbox/favorite' && method === 'POST') {
    const body = await request.json();
    const mb = await env.DB.prepare('SELECT id, is_favorite FROM mailboxes WHERE id = ?')
      .bind(body.mailbox_id).first();
    if (!mb) return json({ error: 'Mailbox not found' }, 404);
    if (!(await canAccessMailbox(env, user, mb.id))) return json({ error: 'Forbidden' }, 403);

    const newVal = mb.is_favorite ? 0 : 1;
    await env.DB.prepare('UPDATE mailboxes SET is_favorite = ? WHERE id = ?').bind(newVal, mb.id).run();
    return json({ ok: true, is_favorite: !!newVal });
  }

  // ======== 随机/自定义生成邮箱 ========

  // GET /api/generate
  if (path === '/api/generate' && method === 'GET') {
    const randomId = Math.random().toString(36).slice(2, 10);
    const email = `${randomId}@${env.DOMAIN}`;
    const localPart = randomId;

    await env.DB.prepare(
      'INSERT OR IGNORE INTO mailboxes (address, local_part, domain) VALUES (?, ?, ?)'
    ).bind(email, localPart, env.DOMAIN).run();

    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(email).first();
    if (mb) {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO user_mailboxes (user_id, mailbox_id) VALUES (?, ?)'
      ).bind(user.id, mb.id).run();
    }

    return json({ email }, 201);
  }

  // POST /api/create — 自定义邮箱
  if (path === '/api/create' && method === 'POST') {
    const body = await request.json();
    const local = String(body.local || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{1,64}$/.test(local)) {
      return json({ error: 'Invalid local part' }, 400);
    }
    const email = `${local}@${env.DOMAIN}`;

    await env.DB.prepare(
      'INSERT OR IGNORE INTO mailboxes (address, local_part, domain) VALUES (?, ?, ?)'
    ).bind(email, local, env.DOMAIN).run();

    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(email).first();
    if (mb) {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO user_mailboxes (user_id, mailbox_id) VALUES (?, ?)'
      ).bind(user.id, mb.id).run();
    }

    return json({ email }, 201);
  }

  // ======== 用户配额 ========

  // GET /api/user/quota
  if (path === '/api/user/quota' && method === 'GET') {
    const mbCount = await env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM user_mailboxes WHERE user_id = ?'
    ).bind(user.id).first();
    return json({
      limit: user.mailbox_limit ?? 10,
      used: mbCount?.cnt || 0,
      remaining: (user.mailbox_limit ?? 10) - (mbCount?.cnt || 0),
    });
  }

  // ======== 发送邮件（Resend 专用） ========

  // POST /api/send
  if (path === '/api/send' && method === 'POST') {
    return await handleSend(request, user, env);
  }

  // ======== 发件记录 ========

  // GET /api/sent?from=xxx
  if (path === '/api/sent' && method === 'GET') {
    const from = url.searchParams.get('from');
    if (!from) return json({ error: 'from parameter required' }, 400);

    // 验证发件人属于当前用户
    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?')
      .bind(from.toLowerCase()).first();
    if (!mb) return json({ sent: [] });
    if (!(await canAccessMailbox(env, user, mb.id))) return json({ error: 'Forbidden' }, 403);

    // 对于管理员，他们可能需要看所有已发邮件
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
    const rows = await env.DB.prepare(
      `SELECT id, resend_id, from_addr, to_addrs, subject, status, created_at, provider
       FROM sent_emails WHERE from_addr = ?
       ORDER BY created_at DESC LIMIT ?`
    ).bind(from.toLowerCase(), limit).all();
    return json({ sent: rows.results || [] });
  }

  // GET /api/sent/:id
  const sentDetail = path.match(/^\/api\/sent\/(\d+)$/);
  if (sentDetail && method === 'GET') {
    const sentId = parseInt(sentDetail[1], 10);
    const sent = await env.DB.prepare(
      `SELECT id, resend_id, from_addr, to_addrs, subject, text_content, status, created_at, provider
       FROM sent_emails WHERE id = ?`
    ).bind(sentId).first();
    if (!sent) return json({ error: 'Not Found' }, 404);

    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?')
      .bind(sent.from_addr).first();
    if (!mb || !(await canAccessMailbox(env, user, mb.id))) {
      return json({ error: 'Forbidden' }, 403);
    }
    return json({ sent });
  }

  // DELETE /api/sent/:id
  if (sentDetail && method === 'DELETE') {
    const sentId = parseInt(sentDetail[1], 10);
    const sent = await env.DB.prepare('SELECT from_addr FROM sent_emails WHERE id = ?').bind(sentId).first();
    if (!sent) return json({ error: 'Not Found' }, 404);
    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?')
      .bind(sent.from_addr).first();
    if (!mb || !(await canAccessMailbox(env, user, mb.id))) {
      return json({ error: 'Forbidden' }, 403);
    }
    await env.DB.prepare('DELETE FROM sent_emails WHERE id = ?').bind(sentId).run();
    return json({ ok: true });
  }

  return json({ error: 'Not Found' }, 404);
}

/* ============================================================
 *  Auth Handlers
 *  ============================================================ */

async function handleAdminCheck(env) {
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE role = ? LIMIT 1'
  ).bind('admin').first();
  return json({ admin_exists: !!existing });
}

async function handleAdminSetup(env) {
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE role = ? LIMIT 1'
  ).bind('admin').first();
  if (existing) return json({ error: 'Admin already exists' }, 403);

  const adminUser = 'admin_' + Math.random().toString(36).slice(2, 8);
  const adminPass = Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10);
  const emailAddress = `${adminUser}@${env.DOMAIN}`.toLowerCase();
  const passwordHash = await sha256(adminPass);

  await env.DB.prepare(
    'INSERT INTO users (username, password_hash, email_address, role, can_send, mailbox_limit) VALUES (?, ?, ?, ?, 1, 999)'
  ).bind(adminUser, passwordHash, emailAddress, 'admin').run();

  // 创建默认邮箱
  await env.DB.prepare(
    'INSERT OR IGNORE INTO mailboxes (address, local_part, domain, can_login) VALUES (?, ?, ?, 1)'
  ).bind(emailAddress, adminUser, env.DOMAIN).run();

  const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(emailAddress).first();
  if (mb) {
    const u = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(adminUser).first();
    if (u) {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO user_mailboxes (user_id, mailbox_id) VALUES (?, ?)'
      ).bind(u.id, mb.id).run();
    }
  }

  return json({ ok: true, username: adminUser, password: adminPass, email: emailAddress }, 201);
}

async function handleRegister(request, env) {
  const setting = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'allow_registration'"
  ).first();
  if (setting?.value !== 'true') {
    return json({ error: 'Registration is closed' }, 403);
  }

  const { username, password } = await request.json();
  if (!username || !password) return json({ error: 'Username and password required' }, 400);
  if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

  const cleanUser = username.toLowerCase().trim();
  const emailAddress = `${cleanUser}@${env.DOMAIN}`.toLowerCase();
  const passwordHash = await sha256(password);

  try {
    const result = await env.DB.prepare(
      'INSERT INTO users (username, password_hash, email_address, role, can_send, mailbox_limit) VALUES (?, ?, ?, ?, 1, 10)'
    ).bind(cleanUser, passwordHash, emailAddress, 'user').run();

    const userId = result.meta.last_row_id;

    // 创建默认邮箱并关联
    await env.DB.prepare(
      'INSERT OR IGNORE INTO mailboxes (address, local_part, domain, can_login) VALUES (?, ?, ?, 1)'
    ).bind(emailAddress, cleanUser, env.DOMAIN).run();

    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(emailAddress).first();
    if (mb) {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO user_mailboxes (user_id, mailbox_id) VALUES (?, ?)'
      ).bind(userId, mb.id).run();
    }

    return json({ ok: true, email: emailAddress }, 201);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return json({ error: 'Username already exists' }, 409);
    throw err;
  }
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  if (!username || !password) return json({ error: 'Username and password required' }, 400);

  const cleanUser = username.toLowerCase().trim();
  const user = await env.DB.prepare(
    'SELECT id, password_hash, role, can_send, mailbox_limit FROM users WHERE username = ?'
  ).bind(cleanUser).first();

  if (!user) return json({ error: 'Invalid credentials' }, 401);

  const hash = await sha256(password);
  if (hash !== user.password_hash) return json({ error: 'Invalid credentials' }, 401);

  const token = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO sessions (user_id, token) VALUES (?, ?)')
    .bind(user.id, token).run();

  return json({
    ok: true,
    token,
    role: user.role,
    can_send: user.can_send,
    mailbox_limit: user.mailbox_limit,
  });
}

/* ============================================================
 *  Send Handler (Resend Only)
 *  ============================================================ */

async function handleSend(request, user, env) {
  const body = await request.json();
  const { to, subject, text, html, from } = body;

  if (!to || !subject || (!text && !html)) {
    return json({ error: 'to, subject, and text or html are required' }, 400);
  }

  // 确定发件地址
  const fromAddr = from
    ? String(from).toLowerCase().trim()
    : (await env.DB.prepare('SELECT email_address FROM users WHERE id = ?').bind(user.id).first())?.email_address;

  if (!fromAddr) return json({ error: 'No from address available' }, 400);

  // 验证发件地址属于当前用户（管理员可以发任意邮件）
  if (!user.is_admin) {
    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(fromAddr).first();
    if (!mb || !(await canAccessMailbox(env, user, mb.id))) {
      return json({ error: 'You do not own this from address' }, 403);
    }
  }

  // 检查用户发件权限
  if (!user.is_admin && !user.can_send) {
    return json({ error: 'You are not allowed to send emails' }, 403);
  }

  // 检查每日限额
  const limitSetting = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'daily_send_limit'"
  ).first();
  const dailyLimit = parseInt(limitSetting?.value || '50', 10);

  const todayCount = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM sent_emails
     WHERE user_id = ? AND date(created_at) = date('now')`
  ).bind(user.id).first();

  if (todayCount.cnt >= dailyLimit) {
    return json({ error: `Daily send limit reached (${dailyLimit})` }, 429);
  }

  // 检查 Resend API Key 是否配置
  const RESEND_API_KEY = env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY not configured. Run: npx wrangler secret put RESEND_API_KEY' }, 500);
  }

  try {
    const payload = {
      from: fromAddr,
      to: Array.isArray(to) ? to : [to],
      subject,
    };
    if (html) payload.html = html;
    else payload.text = text;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      return json({ error: `Resend: ${data.message || data.error || res.statusText}` }, 400);
    }

    // 记录发送
    await env.DB.prepare(
      'INSERT INTO sent_emails (user_id, resend_id, from_addr, to_addrs, subject, text_content, status, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      user.id,
      data.id || null,
      fromAddr,
      Array.isArray(to) ? to.join(', ') : to,
      subject,
      text || null,
      'sent',
      'resend'
    ).run();

    return json({ ok: true, id: data.id, to, subject });
  } catch (err) {
    return json({ error: `Send failed: ${err.message}` }, 500);
  }
}

/* ============================================================
 *  Utils
 *  ============================================================ */

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;

  const token = auth.slice(7);
  const row = await env.DB.prepare(
    `SELECT u.id, u.role, u.can_send, u.mailbox_limit
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).bind(token).first();

  if (!row) return null;
  return {
    id: row.id,
    is_admin: row.role === 'admin',
    role: row.role,
    can_send: row.can_send,
    mailbox_limit: row.mailbox_limit,
  };
}

async function canAccessMailbox(env, user, mailboxId) {
  if (user.is_admin) return true;
  const rel = await env.DB.prepare(
    'SELECT 1 FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ? LIMIT 1'
  ).bind(user.id, mailboxId).first();
  return !!rel;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, { status: response.status, headers });
}