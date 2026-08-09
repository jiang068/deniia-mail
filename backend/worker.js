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

    // 解析当前请求允许的 CORS 来源（见 resolveCorsOrigin）
    resolveCorsOrigin(request, env);

    if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    try {
      // ========== 公开路由 ==========
      if (path === '/api/admin/check' && method === 'GET') {
        return cors(await handleAdminCheck(env));
      }
      if (path === '/api/admin/setup' && method === 'POST') {
        return cors(await handleAdminSetup(request, env));
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

  /* ==================== 定时检查发件状态 ==================== */
  async scheduled(event, env, ctx) {
    if (event.cron === '*/5 * * * *') {
      const RESEND_API_KEY = env.RESEND_API_KEY;
      if (!RESEND_API_KEY) return;

      const pending = await env.DB.prepare(
        "SELECT id, resend_id FROM sent_emails WHERE delivery_status IN ('sending', 'sent') AND resend_id IS NOT NULL LIMIT 50"
      ).all();

      for (const row of (pending.results || [])) {
        try {
          const res = await fetch(`https://api.resend.com/emails/${row.resend_id}`, {
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` }
          });
          if (res.ok) {
            const data = await res.json();
            let status = 'sent';
            if (data.last_event === 'delivered') status = 'delivered';
            else if (data.last_event === 'bounced') status = 'bounced';
            else if (data.last_event === 'complained') status = 'complained';

            await env.DB.prepare(
              "UPDATE sent_emails SET delivery_status = ?, last_checked_at = datetime('now') WHERE id = ?"
            ).bind(status, row.id).run();
          }
        } catch (err) {
          console.error(`Check delivery failed for email ${row.id}:`, err);
        }
      }
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
    const allowed = ['allow_registration', 'daily_send_limit', 'default_mailbox_limit'];
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
    const passwordHash = await hashPassword(body.password);
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
      params.push(await hashPassword(body.password));
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

    // 在 Edge 端使用 PostalMime 自动将 raw_content 解码为 HTML 和 Plain Text
    let htmlContent = null;
    let textContent = null;

    if (msg.raw_content) {
      try {
        const parsed = await PostalMime.parse(msg.raw_content);
        htmlContent = parsed.html || null;
        textContent = parsed.text || null;
      } catch (e) {
        console.error('[MIME Parse Failed]', e);
      }
    }

    return json({
      email: {
        ...msg,
        html: htmlContent || (textContent ? `<div style="white-space: pre-wrap;">${textContent}</div>` : msg.preview),
        text: textContent || msg.preview
      }
    });
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

  // POST /api/emails/check-status — 批量查询发件投递状态
  if (path === '/api/emails/check-status' && method === 'POST') {
    return cors(await handleCheckStatus(request, env, user));
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
      `SELECT id, resend_id, from_addr, to_addrs, subject, SUBSTR(text_content, 1, 200) AS preview, status, delivery_status, created_at, provider
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
      `SELECT id, resend_id, from_addr, to_addrs, subject, text_content, status, delivery_status, created_at, provider
       FROM sent_emails WHERE id = ?`
    ).bind(sentId).first();
    if (!sent) return json({ error: 'Not Found' }, 404);

    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?')
      .bind(sent.from_addr).first();
    if (!mb || !(await canAccessMailbox(env, user, mb.id))) {
      return json({ error: 'Forbidden' }, 403);
    }

    const content = sent.text_content || '';
    const isHtml = content.trim().startsWith('<');

    return json({
      sent: {
        ...sent,
        html: isHtml ? content : `<div style="white-space: pre-wrap; font-family: sans-serif;">${content}</div>`,
        text: content
      }
    });
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
 *  Email Status Check (Resend)
 *  ============================================================ */

async function handleCheckStatus(request, env, user) {
  const body = await request.json();
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return json({ error: 'ids array required' }, 400);
  }

  const RESEND_API_KEY = env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY not configured' }, 500);
  }

  const results = [];
  for (const localId of ids) {
    const sent = await env.DB.prepare(
      'SELECT id, resend_id, delivery_status FROM sent_emails WHERE id = ? AND user_id = ?'
    ).bind(localId, user.id).first();

    if (!sent || !sent.resend_id) {
      results.push({ id: localId, delivery_status: sent?.delivery_status || 'unknown' });
      continue;
    }

    try {
      const res = await fetch(`https://api.resend.com/emails/${sent.resend_id}`, {
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` }
      });

      if (res.ok) {
        const emailData = await res.json();
        let status = 'sent';
        if (emailData.last_event === 'delivered') status = 'delivered';
        else if (emailData.last_event === 'bounced') status = 'bounced';
        else if (emailData.last_event === 'complained') status = 'complained';
        else if (emailData.last_event === 'opened') status = 'opened';

        await env.DB.prepare(
          'UPDATE sent_emails SET delivery_status = ?, last_checked_at = datetime(\'now\') WHERE id = ?'
        ).bind(status, localId).run();

        results.push({ id: localId, delivery_status: status });
      } else {
        results.push({ id: localId, delivery_status: sent.delivery_status });
      }
    } catch {
      results.push({ id: localId, delivery_status: sent.delivery_status });
    }
  }

  return json({ results });
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

async function handleAdminSetup(request, env) {
  // 初始化是极罕见的操作，加上 IP 与全局限速，防止被并行/暴力触发创建
  const ip = request?.headers?.get('CF-Connecting-IP') || 'unknown';
  const ipGate = rateLimit(`setup:ip:${ip}`, 3, 10 * 60);
  const globalGate = rateLimit('setup:global', 5, 10 * 60);
  if (ipGate.blocked || globalGate.blocked) {
    return json({ error: 'Too many setup attempts. Try again later.' }, 429);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE role = ? LIMIT 1'
  ).bind('admin').first();
  if (existing) return json({ error: 'Admin already exists' }, 403);

  // 二次确认防止竞态：存在 sys_setup_in_progress 标记则拒绝
  const lock = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'setup_in_progress'"
  ).first();
  if (lock) return json({ error: 'Setup already in progress' }, 409);

  // 先写入锁标记（幂等），再创建管理员
  await env.DB.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('setup_in_progress', '1')"
  ).run();

  // 再次检查，确保锁生效后仍无 admin
  const recheck = await env.DB.prepare(
    'SELECT id FROM users WHERE role = ? LIMIT 1'
  ).bind('admin').first();
  if (recheck) {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'setup_in_progress'").run();
    return json({ error: 'Admin already exists' }, 403);
  }

  const adminUser = 'admin_' + Math.random().toString(36).slice(2, 8);
  const adminPass = Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10);
  const emailAddress = `${adminUser}@${env.DOMAIN}`.toLowerCase();
  const passwordHash = await hashPassword(adminPass);

  try {
    await env.DB.prepare(
      'INSERT INTO users (username, password_hash, email_address, role, can_send, mailbox_limit) VALUES (?, ?, ?, ?, 1, 999)'
    ).bind(adminUser, passwordHash, emailAddress, 'admin').run();
  } catch (err) {
    // 插入失败则释放锁
    await env.DB.prepare("DELETE FROM settings WHERE key = 'setup_in_progress'").run();
    if (err.message?.includes('UNIQUE')) {
      return json({ error: 'Admin already exists' }, 409);
    }
    throw err;
  }

  // 清除锁标记
  await env.DB.prepare("DELETE FROM settings WHERE key = 'setup_in_progress'").run();

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
  const passwordHash = await hashPassword(password);

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
  if (typeof username !== 'string' || typeof password !== 'string') {
    return json({ error: 'Invalid request' }, 400);
  }
  if (!username || !password) return json({ error: 'Username and password required' }, 400);

  const cleanUser = username.toLowerCase().trim();
  if (!cleanUser) return json({ error: 'Invalid request' }, 400);

  // 速率限制：IP 级 + 账号级
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipGate = rateLimit(`ip:${ip}`, 30, 60); // 同一 IP 每分钟最多 30 次登录尝试
  if (ipGate.blocked) {
    return json({ error: 'Too many attempts. Try again later.' }, 429);
  }
  const userGate = rateLimit(`user:${cleanUser}`, 10, 10 * 60); // 同账号 10 分钟内最多 10 次失败
  if (userGate.blocked) {
    return json({ error: 'Too many failed attempts. Account locked for 10 minutes.' }, 429);
  }

  const user = await env.DB.prepare(
    'SELECT id, password_hash, role, can_send, mailbox_limit FROM users WHERE username = ?'
  ).bind(cleanUser).first();

  if (!user) return json({ error: 'Invalid credentials' }, 401);

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    failLogin(cleanUser);
    return json({ error: 'Invalid credentials' }, 401);
  }

  clearFailures(cleanUser);
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

  // 突发限速：同一用户 60 秒内最多发 5 封（配合每日限额形成双层防护）
  const burstGate = rateLimit(`send:user:${user.id}`, 5, 60);
  if (burstGate.blocked) {
    return json({ error: 'Sending too fast. Please slow down.' }, 429);
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

    const contentToSave = html || text || '';

    await env.DB.prepare(
      'INSERT INTO sent_emails (user_id, resend_id, from_addr, to_addrs, subject, text_content, status, delivery_status, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      user.id,
      data.id || null,
      fromAddr,
      Array.isArray(to) ? to.join(', ') : to,
      subject,
      contentToSave,
      'sent',
      'sending',
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

/* ============================================================
 *  速率限制与密码验证
 *  ============================================================ */

// 内存中的滑动窗口计数器（单实例 Worker 有效）。
// key → { count, windowStart }
const rateLimitStore = new Map();
// 账号级失败计数器（用于登录锁定）
const loginFailures = new Map();

function rateLimit(key, max, seconds) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart > seconds * 1000) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { blocked: false, count: 1 };
  }

  entry.count += 1;
  if (entry.count > max) {
    return { blocked: true, count: entry.count };
  }
  return { blocked: false, count: entry.count };
}

function failLogin(username) {
  const now = Date.now();
  const entry = loginFailures.get(username) || { count: 0, firstAt: now };
  entry.count += 1;
  loginFailures.set(username, entry);
  // 清理过期的窗口（10 分钟）
  if (now - entry.firstAt > 10 * 60 * 1000) {
    loginFailures.set(username, { count: 1, firstAt: now });
  }
}

function clearFailures(username) {
  loginFailures.delete(username);
}

// 兼容旧版 sha256 哈希与新版（带迭代的非对称常数）哈希。
// 生产中理想用 scrypt/argon2，但 Workers 无内置，这里用多次迭代的 PBKDF2 风格加强。
async function verifyPassword(password, storedHash) {
  // 旧格式：直接 sha256 十六进制
  if (/^[0-9a-f]{64}$/.test(storedHash)) {
    const hash = await sha256(password);
    return hash === storedHash;
  }
  // 新格式：scrypt:iterations:salt:hash （iterations 用于长度恒定比较）
  const parts = storedHash.split(':');
  if (parts.length < 3) return false;
  const iterations = parseInt(parts[0], 10);
  const salt = parts[1];
  const expected = parts[2];
  const derived = await deriveKey(password, salt, iterations);
  return derived === expected;
}

async function deriveKey(password, salt, iterations) {
  const enc = new TextEncoder();
  let data = new Uint8Array(enc.encode(password + ':' + salt));
  for (let i = 0; i < iterations; i++) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    data = new Uint8Array(buf);
  }
  return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hashPassword(password) {
  const salt = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const iterations = 10000;
  return deriveKey(password, salt, iterations).then(hash => `pbkdf:${iterations}:${salt}:${hash}`);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// 当前请求匹配到的来源（由 resolveCorsOrigin 设置）
let currentAllowedOrigin = '*';

function resolveCorsOrigin(request, env) {
  // 默认：未配置 ALLOWED_ORIGINS 时保持全开（向后兼容）
  const allowedRaw = env.ALLOWED_ORIGINS;
  if (!allowedRaw) {
    currentAllowedOrigin = '*';
    return;
  }

  const allowedSet = new Set(
    String(allowedRaw).split(',').map(s => s.trim()).filter(Boolean)
  );
  const origin = request.headers.get('Origin') || '';

  // 匹配则回显该来源
  if (allowedSet.has(origin)) {
    currentAllowedOrigin = origin;
    return;
  }
  // 未匹配的跨域请求：不返回 CORS 头（浏览器会拦截）
  currentAllowedOrigin = 'null';
}

function cors(response) {
  const headers = new Headers(response.headers);
  if (currentAllowedOrigin === 'null') {
    // 不放行跨域
    return new Response(response.body, { status: response.status, headers });
  }
  headers.set('Access-Control-Allow-Origin', currentAllowedOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // 预检缓存 24h：跨源 + Authorization 必触发 OPTIONS，缓存后浏览器不再对每个请求预检，
  // 直接消灭日志里成堆的 204(几秒级延迟)。跨源配置时常变，留 24h 平衡灵活性与性能。
  headers.set('Access-Control-Max-Age', '86400');
  if (currentAllowedOrigin !== '*') {
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Credentials', 'false');
  }
  return new Response(response.body, { status: response.status, headers });
}