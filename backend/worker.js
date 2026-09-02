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

    // CORS 来源必须是请求级变量；不能放在 Worker 模块全局，否则并发请求会互相覆盖。
    const allowedOrigin = resolveCorsOrigin(request, env);

    if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }), allowedOrigin);

    try {
      // ========== 公开路由 ==========
      if (path === '/api/admin/check' && method === 'GET') {
        return cors(await handleAdminCheck(env), allowedOrigin);
      }
      if (path === '/api/admin/setup' && method === 'POST') {
        return cors(await handleAdminSetup(request, env), allowedOrigin);
      }
      if (path === '/api/register' && method === 'POST') {
        return cors(await handleRegister(request, env), allowedOrigin);
      }
      if (path === '/api/login' && method === 'POST') {
        return cors(await handleLogin(request, env), allowedOrigin);
      }
      if (path === '/api/domains' && method === 'GET') {
        return cors(json({ domains: [env.DOMAIN] }), allowedOrigin);
      }

      // Resend Webhook：由 Resend 后台调用（免用户鉴权，靠 env.RESEND_WEBHOOK_SECRET 签名保护）
      if (path === '/api/webhooks/resend' && method === 'POST') {
        return await handleResendWebhook(request, env);
      }

      // ========== 需要认证的路由 ==========
      const user = await authenticate(request, env);
      if (!user) return cors(json({ error: 'Unauthorized' }, 401), allowedOrigin);

      // -- 管理后台 --
      if (path.startsWith('/api/admin/')) {
        if (!user.is_admin) return cors(json({ error: 'Forbidden' }, 403), allowedOrigin);
        return cors(await handleAdminRoutes(request, env, path, method, url, user), allowedOrigin);
      }

      // -- 前台 API --
      return cors(await handleUserRoutes(request, env, path, method, url, user), allowedOrigin);
    } catch (err) {
      console.error('Unhandled error:', err);
      return cors(json({ error: 'Internal Server Error' }, 500), allowedOrigin);
    }
  },

  /* ==================== 邮件接收 ==================== */
  async email(message, env, ctx) {
    try {
      const rawText = await new Response(message.raw).text();
      const parsed = await PostalMime.parse(rawText);

      const rawRecipients = Array.isArray(message.to) ? message.to : [message.to];
      const recipients = rawRecipients.map(r => (typeof r === 'string' ? r : r?.address || r));

      const senderAddr = (parsed.from?.address || message.from || '').toLowerCase();
      const senderDomain = senderAddr.slice(senderAddr.lastIndexOf('@') + 1);

      for (const toAddr of recipients) {
        if (!toAddr) continue;
        const cleanTo = toAddr.toLowerCase().trim();

        // 查找收件邮箱
        const mailbox = await env.DB.prepare(
          'SELECT id, forward_to FROM mailboxes WHERE address = ?'
        ).bind(cleanTo).first();

        // 目标邮箱：默认就是收件地址所属邮箱；若系统里不存在该邮箱，
        // 尝试按发件方域名后缀白名单路由到指定的 catch-all 目标邮箱。
        let targetMailbox = mailbox ? mailbox.id : null;

        if (!mailbox) {
          targetMailbox = await resolveCatchallTarget(env, senderDomain);
          if (!targetMailbox) {
            console.log(`[Email] 未找到邮箱 ${cleanTo} 且发件方不在白名单，丢弃`);
            continue;
          }
          console.log(`[Email] 白名单命中：${cleanTo} -> ${targetMailbox}`);
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
          `INSERT INTO messages (mailbox_id, sender, to_addrs, subject, preview, raw_content, html_content, text_content, verification_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          targetMailbox,
          senderAddr,
          cleanTo,
          subject,
          preview || null,
          safeRaw,
          parsed.html || null,
          parsed.text || null,
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
        "SELECT id, resend_id, delivery_event_at FROM sent_emails WHERE delivery_status IN ('sending', 'sent', 'delayed') AND resend_id IS NOT NULL LIMIT 50"
      ).all();

      await mapWithConcurrency(pending.results || [], 5, async (row) => {
        try {
          const res = await fetchWithTimeout(`https://api.resend.com/emails/${row.resend_id}`, {
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` }
          }, 10000);
          if (res.ok) {
            const data = await res.json();
            const status = resendStatus(data.last_event) || 'sent';

            // 有 webhook 事件时以 webhook 为准，轮询只负责尚未收到 webhook 的记录。
            if (!row.delivery_event_at) {
              await env.DB.prepare(
                "UPDATE sent_emails SET delivery_status = ?, last_checked_at = datetime('now') WHERE id = ? AND delivery_event_at IS NULL"
              ).bind(status, row.id).run();
            }
          }
        } catch (err) {
          console.error(`Check delivery failed for email ${row.id}:`, err);
        }
      });
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
    const allowed = ['allow_registration', 'daily_send_limit', 'default_mailbox_limit', 'site_daily_limit', 'catchall_target', 'catchall_mode'];
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
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 200);
    const rows = await env.DB.prepare(
      `SELECT u.id, u.username, u.email_address, u.role, u.can_send, u.mailbox_limit, u.created_at,
              COUNT(um.mailbox_id) AS mailbox_count,
              GROUP_CONCAT(m.address, ',') AS mailbox_addresses
       FROM users u
       LEFT JOIN user_mailboxes um ON um.user_id = u.id
       LEFT JOIN mailboxes m ON m.id = um.mailbox_id
       GROUP BY u.id
       ORDER BY u.created_at ${sort === 'asc' ? 'ASC' : 'DESC'} LIMIT ?`
    ).bind(limit).all();

    const users = (rows.results || []).map(r => ({
      ...r,
      mailboxes: r.mailbox_addresses ? String(r.mailbox_addresses).split(',') : [],
    }));
    users.forEach(r => { delete r.mailbox_addresses; });
    return json({ users });
  }

  // POST /api/admin/users — 管理员创建用户
  if (path === '/api/admin/users' && method === 'POST') {
    const body = await request.json();
    const username = String(body.username || '').trim().toLowerCase();
    if (!username) return json({ error: 'Username required' }, 400);
    if (!isValidNickname(username)) {
      return json({ error: '昵称只能包含英文字母、数字、._-（最长 32 位）' }, 400);
    }
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
    let protectsLastAdmin = false;

    // 不允许把最后一个管理员降为普通用户；条件放进 UPDATE，
    // 这样两个并发降权请求也不会把管理员数量降到 0。
    if (body.role && body.role !== 'admin') {
      const target = await env.DB.prepare(
        'SELECT role FROM users WHERE id = ?'
      ).bind(id).first();
      if (!target) return json({ error: 'User not found' }, 404);
      protectsLastAdmin = target.role === 'admin';
    }

    if (body.role) { updates.push('role = ?'); params.push(body.role === 'admin' ? 'admin' : 'user'); }
    if (body.can_send !== undefined) { updates.push('can_send = ?'); params.push(body.can_send ? 1 : 0); }
    if (body.mailbox_limit !== undefined) { updates.push('mailbox_limit = ?'); params.push(parseInt(body.mailbox_limit, 10) || 10); }
    if (body.password) {
      updates.push('password_hash = ?');
      params.push(await hashPassword(body.password));
    }

    if (updates.length === 0) return json({ error: 'No fields to update' }, 400);
    params.push(id);
    const where = protectsLastAdmin
      ? `WHERE id = ? AND (
           role != 'admin' OR
           (SELECT COUNT(*) FROM users WHERE role = 'admin') > 1
         )`
      : 'WHERE id = ?';
    const result = await env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} ${where}`
    ).bind(...params).run();
    if (protectsLastAdmin && Number(result.meta?.changes || 0) !== 1) {
      return json({ error: 'Cannot remove the last admin' }, 409);
    }
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

  // ==================== 邀请码管理 ====================

  // GET /api/admin/invites — 列出所有邀请码及使用情况
  if (path === '/api/admin/invites' && method === 'GET') {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1), 500);
    const rows = await env.DB.prepare(
      'SELECT id, code, max_uses, used_count, created_by, created_at FROM invite_codes ORDER BY created_at DESC LIMIT ?'
    ).bind(limit).all();
    return json({ invites: rows.results || [] });
  }

  // POST /api/admin/invites — 批量生成邀请码
  if (path === '/api/admin/invites' && method === 'POST') {
    const body = await request.json();
    const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 100);
    const uses = Math.min(Math.max(parseInt(body.uses, 10) || 1, 1), 1000);
    const codes = [];
    for (let i = 0; i < count; i++) {
      const code = 'DM' + crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
      await env.DB.prepare(
        'INSERT OR IGNORE INTO invite_codes (code, max_uses, created_by) VALUES (?, ?, ?)'
      ).bind(code, uses, user.id).run();
      codes.push(code);
    }
    return json({ ok: true, codes }, 201);
  }

  // DELETE /api/admin/invites/:id — 吊销邀请码
  const invDelete = path.match(/^\/api\/admin\/invites\/(\d+)$/);
  if (invDelete && method === 'DELETE') {
    const id = parseInt(invDelete[1], 10);
    await env.DB.prepare('DELETE FROM invite_codes WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  // ==================== 邮箱 / 邮件全局查看 ====================

  // GET /api/admin/mailboxes — 所有邮箱（含未分配/停用）及归属与邮件数
  if (path === '/api/admin/mailboxes' && method === 'GET') {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500);
    const rows = await env.DB.prepare(
      `SELECT m.id, m.address, m.local_part, m.domain, m.can_login, m.is_favorite, m.created_at,
              GROUP_CONCAT(DISTINCT u.username) AS owner,
              COUNT(DISTINCT msg.id) AS msg_count
       FROM mailboxes m
       LEFT JOIN user_mailboxes um ON um.mailbox_id = m.id
       LEFT JOIN users u ON u.id = um.user_id
       LEFT JOIN messages msg ON msg.mailbox_id = m.id
       GROUP BY m.id
       ORDER BY m.created_at DESC LIMIT ?`
    ).bind(limit).all();
    return json({ mailboxes: rows.results || [] });
  }

  // GET /api/admin/mailboxes/:id/emails — 指定邮箱的全部邮件（admin 可见未启用邮箱邮件）
  const adminMbEmails = path.match(/^\/api\/admin\/mailboxes\/(\d+)\/emails$/);
  if (adminMbEmails && method === 'GET') {
    const mailboxId = parseInt(adminMbEmails[1], 10);
    const rows = await env.DB.prepare(
      `SELECT id, mailbox_id, sender, to_addrs, subject, preview, received_at, is_read
       FROM messages WHERE mailbox_id = ?
       ORDER BY received_at DESC LIMIT 100`
    ).bind(mailboxId).all();
    return json({ emails: rows.results || [] });
  }

  // GET /api/admin/email/:id — 管理员查看任意邮件详情（含未启用邮箱）
  const adminEmail = path.match(/^\/api\/admin\/email\/(\d+)$/);
  if (adminEmail && method === 'GET') {
    const emailId = parseInt(adminEmail[1], 10);
    const includeRaw = url.searchParams.get('raw') === '1';
    const msg = await env.DB.prepare(
      `SELECT m.id, m.mailbox_id, m.sender, m.to_addrs, m.subject, m.preview,
              m.html_content, m.text_content,
              CASE WHEN m.html_content IS NULL AND m.text_content IS NULL THEN m.raw_content END AS legacy_raw_content,
              m.verification_code, m.received_at, m.is_read,
              ${includeRaw ? 'm.raw_content,' : ''} mb.address AS mailbox_address
       FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE m.id = ?`
    ).bind(emailId).first();
    if (!msg) return json({ error: 'Not Found' }, 404);

    let htmlContent = msg.html_content || null;
    let textContent = msg.text_content || null;
    // 兼容迁移前的旧邮件；新邮件直接使用入库时解析好的正文。
    if ((!htmlContent && !textContent) && msg.legacy_raw_content) {
      try {
        const parsed = await PostalMime.parse(msg.legacy_raw_content);
        htmlContent = parsed.html || null;
        textContent = parsed.text || null;
      } catch (e) { /* ignore parse errors */ }
    }
    return json({
      email: {
        ...msg,
        html: htmlContent || (textContent ? `<div style="white-space: pre-wrap;">${textContent}</div>` : msg.preview),
        text: textContent || msg.preview,
        ...(includeRaw ? { raw_content: msg.raw_content || null } : {}),
      }
    });
  }

  // GET /api/admin/sent — 管理员查看全部已发送邮件（所有用户）
  if (path === '/api/admin/sent' && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
    const rows = await env.DB.prepare(
      `SELECT se.id, se.from_addr, se.to_addrs, se.subject,
              SUBSTR(se.text_content, 1, 200) AS preview, se.delivery_status, se.created_at,
              u.username AS sender_user
       FROM sent_emails se LEFT JOIN users u ON u.id = se.user_id
       ORDER BY se.created_at DESC LIMIT ?`
    ).bind(limit).all();
    return json({ sent: rows.results || [] });
  }

  // GET /api/admin/sent/daily — 全站每天发件量统计（对照 Resend 每日限额）
  if (path === '/api/admin/sent/daily' && method === 'GET') {
    const days = Math.min(parseInt(url.searchParams.get('days') || '14', 10), 90);
    const rows = await env.DB.prepare(
      `SELECT date(created_at, '+8 hours') AS day, COUNT(*) AS cnt
       FROM sent_emails
       WHERE provider = 'resend'
       GROUP BY date(created_at, '+8 hours')
       ORDER BY day DESC LIMIT ?`
    ).bind(days).all();
    const todayRow = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM sent_emails
       WHERE provider = 'resend' AND date(created_at, '+8 hours') = date('now', '+8 hours')`
    ).first();
    const limitSetting = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'site_daily_limit'"
    ).first();
    return json({
      days: rows.results || [],
      today: todayRow?.cnt || 0,
      limit: parseInt(limitSetting?.value || '100', 10),
    });
  }

  // GET /api/admin/sent/:id — 管理员查看任意已发送邮件详情
  const adminSentDetail = path.match(/^\/api\/admin\/sent\/(\d+)$/);
  if (adminSentDetail && method === 'GET') {
    const sentId = parseInt(adminSentDetail[1], 10);
    const sent = await env.DB.prepare(
      `SELECT se.id, se.user_id, se.resend_id, se.from_addr, se.to_addrs, se.subject,
              se.text_content, se.status, se.delivery_status, se.last_checked_at,
              se.delivery_event_at, se.created_at, se.provider, u.username AS sender_user
       FROM sent_emails se LEFT JOIN users u ON u.id = se.user_id WHERE se.id = ?`
    ).bind(sentId).first();
    if (!sent) return json({ error: 'Not Found' }, 404);

    const content = sent.text_content || '';
    const isHtml = content.trim().startsWith('<');
    return json({
      sent: {
        ...sent,
        html: isHtml ? content : `<div style="white-space: pre-wrap; font-family: sans-serif;">${content}</div>`,
        text: content,
        content,
      }
    });
  }

  // ==================== Catch-all 发件白名单 ====================

  // GET /api/admin/whitelist — 白名单列表 + 全局目标
  if (path === '/api/admin/whitelist' && method === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT id, domain_suffix, target, note, created_at FROM catchall_whitelist ORDER BY created_at DESC'
    ).all();
    const global = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'catchall_target'"
    ).first();
    const modeRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'catchall_mode'"
    ).first();

    // 可选目标范围：当前管理员账户下管辖的邮箱
    const ownRows = await env.DB.prepare(
      `SELECT m.id, m.address FROM user_mailboxes um
       JOIN mailboxes m ON m.id = um.mailbox_id
       WHERE um.user_id = ? ORDER BY m.address ASC`
    ).bind(user.id).all();

    return json({
      whitelist: rows.results || [],
      global_target: global?.value || '',
      mode: modeRow?.value || 'off',
      my_mailboxes: (ownRows.results || []).map(r => r.address),
    });
  }

  // POST /api/admin/whitelist — 添加一条白名单（domain_suffix 必填，target 可选）
  if (path === '/api/admin/whitelist' && method === 'POST') {
    const body = await request.json();
    const suffix = String(body.domain_suffix || '').trim().toLowerCase();
    if (!suffix || (suffix !== '*' && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(suffix))) {
      return json({ error: '域名后缀无效，例如 gmail.com（"*" 表示匹配任意发件方）' }, 400);
    }
    let target = String(body.target || '').trim().toLowerCase();
    if (target) {
      const m = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(target).first();
      if (!m) return json({ error: '目标邮箱不存在' }, 400);
    } else {
      target = ''; // 未指定则回退到全局 catchall_target
    }
    const note = String(body.note || '').trim().slice(0, 200);
    await env.DB.prepare(
      'INSERT INTO catchall_whitelist (domain_suffix, target, note) VALUES (?, ?, ?)'
    ).bind(suffix, target || null, note || null).run();
    return json({ ok: true });
  }

  // DELETE /api/admin/whitelist/:id — 删除白名单条目
  const wlDelete = path.match(/^\/api\/admin\/whitelist\/(\d+)$/);
  if (wlDelete && method === 'DELETE') {
    const id = parseInt(wlDelete[1], 10);
    await env.DB.prepare('DELETE FROM catchall_whitelist WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'Not Found' }, 404);
}

/* ============================================================
 *  User Routes (Authenticated)
 *  ============================================================ */

async function getUserMailboxes(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT m.id, m.address, m.created_at, um.is_pinned, m.is_favorite, m.forward_to,
            CASE WHEN EXISTS (
              SELECT 1 FROM messages unread
              WHERE unread.mailbox_id = m.id AND unread.is_read = 0
            ) THEN 1 ELSE 0 END AS has_unread
     FROM user_mailboxes um
     JOIN mailboxes m ON m.id = um.mailbox_id
     WHERE um.user_id = ?
     ORDER BY um.is_pinned DESC, m.created_at DESC`
  ).bind(userId).all();
  return rows.results || [];
}

async function getUserQuota(env, user) {
  const mbCount = await env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM user_mailboxes WHERE user_id = ?'
  ).bind(user.id).first();
  const limit = user.mailbox_limit ?? 10;
  const used = Number(mbCount?.cnt || 0);
  return { limit, used, remaining: Math.max(0, limit - used) };
}

async function handleMe(env, user) {
  const [mailboxes, quota] = await Promise.all([
    getUserMailboxes(env, user.id),
    getUserQuota(env, user),
  ]);
  return json({
    user: {
      id: user.id,
      username: user.username,
      email_address: user.email_address,
      role: user.role,
      can_send: user.can_send,
      mailbox_limit: user.mailbox_limit,
    },
    mailboxes,
    quota,
  });
}

async function handleUserRoutes(request, env, path, method, url, user) {
  // 首屏只需一次认证请求即可拿到用户、邮箱与配额，避免路由守卫串行打 3 个接口。
  if (path === '/api/me' && method === 'GET') {
    return await handleMe(env, user);
  }

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

    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const query = cursor
      ? `SELECT id, sender, to_addrs, subject, preview, received_at, is_read, verification_code
         FROM messages WHERE mailbox_id = ?
           AND (received_at < ? OR (received_at = ? AND id < ?))
         ORDER BY received_at DESC, id DESC LIMIT ?`
      : `SELECT id, sender, to_addrs, subject, preview, received_at, is_read, verification_code
         FROM messages WHERE mailbox_id = ?
         ORDER BY received_at DESC, id DESC LIMIT ?`;
    const params = cursor
      ? [mb.id, cursor.timestamp, cursor.timestamp, cursor.id, limit]
      : [mb.id, limit];
    const rows = await env.DB.prepare(
      query
    ).bind(...params).all();
    const emails = rows.results || [];
    return json({
      emails,
      next_cursor: emails.length === limit
        ? encodeCursor({ timestamp: emails[emails.length - 1].received_at, id: emails[emails.length - 1].id })
        : null,
    });
  }

  // GET /api/email/:id
  const emailDetail = path.match(/^\/api\/email\/(\d+)$/);
  if (emailDetail && method === 'GET') {
    const emailId = parseInt(emailDetail[1], 10);
    const includeRaw = url.searchParams.get('raw') === '1';
    const msg = await env.DB.prepare(
      `SELECT m.id, m.mailbox_id, m.sender, m.to_addrs, m.subject, m.preview,
              m.html_content, m.text_content,
              CASE WHEN m.html_content IS NULL AND m.text_content IS NULL THEN m.raw_content END AS legacy_raw_content,
              m.verification_code, m.received_at, m.is_read,
              ${includeRaw ? 'm.raw_content,' : ''} mb.address AS mailbox_address
       FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE m.id = ?`
    ).bind(emailId).first();
    if (!msg) return json({ error: 'Not Found' }, 404);
    if (!(await canAccessMailbox(env, user, msg.mailbox_id))) {
      return json({ error: 'Forbidden' }, 403);
    }

    await env.DB.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').bind(emailId).run();

    let htmlContent = msg.html_content || null;
    let textContent = msg.text_content || null;

    // 兼容迁移前的旧邮件；新邮件直接使用入库时解析好的正文。
    if ((!htmlContent && !textContent) && msg.legacy_raw_content) {
      try {
        const parsed = await PostalMime.parse(msg.legacy_raw_content);
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
        text: textContent || msg.preview,
        ...(includeRaw ? { raw_content: msg.raw_content || null } : {}),
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
    return await handleCheckStatus(request, env, user);
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
    return json({ mailboxes: await getUserMailboxes(env, user.id) });
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

  // DELETE /api/mailbox/:id — 删除用户拥有的指定邮箱
  const delMbox = path.match(/^\/api\/mailbox\/(\d+)$/);
  if (delMbox && method === 'DELETE') {
    const mboxId = parseInt(delMbox[1], 10);
    const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE id = ?').bind(mboxId).first();
    if (!mb) return json({ error: 'Mailbox not found' }, 404);
    if (!(await canAccessMailbox(env, user, mb.id))) return json({ error: 'Forbidden' }, 403);

    // messages 表对 mailbox_id 无级联删除，须先显式删除该邮箱的邮件
    await env.DB.prepare('DELETE FROM messages WHERE mailbox_id = ?').bind(mboxId).run();
    // 删除 mailboxes 行；user_mailboxes 由 ON DELETE CASCADE 自动清理
    await env.DB.prepare('DELETE FROM mailboxes WHERE id = ?').bind(mboxId).run();
    return json({ ok: true });
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
    return json(await getUserQuota(env, user));
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
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const query = cursor
      ? `SELECT id, resend_id, from_addr, to_addrs, subject, SUBSTR(text_content, 1, 200) AS preview, status, delivery_status, created_at, provider
         FROM sent_emails WHERE from_addr = ?
           AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC LIMIT ?`
      : `SELECT id, resend_id, from_addr, to_addrs, subject, SUBSTR(text_content, 1, 200) AS preview, status, delivery_status, created_at, provider
         FROM sent_emails WHERE from_addr = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`;
    const params = cursor
      ? [from.toLowerCase(), cursor.timestamp, cursor.timestamp, cursor.id, limit]
      : [from.toLowerCase(), limit];
    const rows = await env.DB.prepare(
      query
    ).bind(...params).all();
    const sent = rows.results || [];
    return json({
      sent,
      next_cursor: sent.length === limit
        ? encodeCursor({ timestamp: sent[sent.length - 1].created_at, id: sent[sent.length - 1].id })
        : null,
    });
  }

  // GET /api/sent/:id
  const sentDetail = path.match(/^\/api\/sent\/(\d+)$/);
  if (sentDetail && method === 'GET') {
    const sentId = parseInt(sentDetail[1], 10);
    const sent = await env.DB.prepare(
      `SELECT id, resend_id, from_addr, to_addrs, subject, text_content, status, delivery_status, last_checked_at, delivery_event_at, created_at, provider
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
        text: content,
        content,
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
 *  Resend Webhook（实时投递状态）
 *  由 Resend 后台在邮件事件发生时主动 POST 到此端点，
 *  用 resend_id 更新 sent_emails.delivery_status。
 *  免用户鉴权，靠 env.RESEND_WEBHOOK_SECRET（svix 签名）保护。
 *  ============================================================ */

async function resolveCatchallTarget(env, senderAddr) {
  const senderDomain = String(senderAddr || '').toLowerCase();
  if (!senderDomain) return null;

  // 模式：off = 关闭（默认，直接丢弃）；whitelist = 仅白名单/`*`；all = 全放开（任意发件方）
  const modeRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'catchall_mode'").first();
  const mode = modeRow?.value || 'off';

  if (mode === 'off') return null;

  let preferredTarget = '';
  if (mode === 'whitelist') {
    let rows;
    try {
      rows = await env.DB.prepare('SELECT domain_suffix, target FROM catchall_whitelist').all();
    } catch (e) {
      console.error('[Email] 读取白名单出错（表可能未迁移）:', e.message);
      return null;
    }
    for (const r of (rows.results || [])) {
      const suffix = String(r.domain_suffix || '').toLowerCase();
      if (!suffix) continue;
      // 后缀匹配：域名等于后缀，或以 "后缀." 结尾（含子域）。"*" 匹配任意发件方。
      if (suffix === '*' || senderDomain === suffix || senderDomain.endsWith('.' + suffix)) {
        preferredTarget = r.target;
        break;
      }
    }
    if (preferredTarget === undefined || preferredTarget === null) return null; // 白名单未命中，丢弃
  }

  // 解析目标邮箱地址：条目 target 未指定时回退到全局 catchall_target
  let target = String(preferredTarget || '').toLowerCase().trim();
  if (!target) {
    const s = await env.DB.prepare("SELECT value FROM settings WHERE key = 'catchall_target'").first();
    target = String(s?.value || '').toLowerCase().trim();
  }
  if (!target) return null; // 没有配置目标邮箱，无法投递

  const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(target).first();
  return mb ? mb.id : null;
}

function resendStatus(event) {
  const map = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.delivery_delayed': 'delayed',
    'email.opened': 'opened',
    'email.clicked': 'opened',
    'email.failed': 'failed',
    'email.suppressed': 'suppressed',
    // Resend API 查询返回 last_event 时没有 email. 前缀。
    sent: 'sent',
    delivered: 'delivered',
    bounced: 'bounced',
    complained: 'complained',
    delivery_delayed: 'delayed',
    opened: 'opened',
    clicked: 'opened',
    failed: 'failed',
    suppressed: 'suppressed',
  };
  return map[event] || null;
}

function normalizeEventTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function handleResendWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const rawBody = await request.text();
  if (!rawBody) return new Response('Bad Request', { status: 400 });

  // Webhook 必须配置签名密钥；未配置时拒绝接收，避免留下公开写接口。
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response('Webhook secret not configured', { status: 503 });
  const ok = await verifySvixSignature(request, rawBody, secret);
  if (!ok) return new Response('Invalid Signature', { status: 401 });

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return new Response('Invalid Payload', { status: 400 });
  }

  const { type, data } = payload;
  if (!type || !data || !data.email_id) {
    return new Response('Invalid Payload', { status: 400 });
  }

  const eventId = request.headers.get('svix-id');
  const eventTime = normalizeEventTime(data.created_at || payload.created_at);
  const eventInsert = await env.DB.prepare(
    'INSERT OR IGNORE INTO webhook_events (event_id, event_type, resend_id, event_at) VALUES (?, ?, ?, ?)'
  ).bind(eventId, type, data.email_id, eventTime).run();
  if (Number(eventInsert.meta?.changes || 0) === 0) {
    return new Response(JSON.stringify({ success: true, duplicate: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const newStatus = resendStatus(type);
  if (newStatus) {
    await env.DB.prepare(
      `UPDATE sent_emails
       SET delivery_status = ?, delivery_event_at = ?, last_checked_at = datetime('now')
       WHERE resend_id = ? AND (delivery_event_at IS NULL OR delivery_event_at <= ?)`
    ).bind(newStatus, eventTime, data.email_id, eventTime).run();
    console.log(`[Webhook] resend_id ${data.email_id} -> ${newStatus}`);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// svix 签名校验：HMAC-SHA256(base64解码后的 key, `{svix-id}.{svix-timestamp}.{body}`)，签名以 base64 编码
// 注意：whsec_ 密钥主体是 Base64 编码的二进制 Key，必须先解码成字节再作为 HMAC key，
//       不能直接用 TextEncoder 编码字符串（那样会得到错误的签名）。
async function verifySvixSignature(request, rawBody, secret) {
  try {
    const svixId = request.headers.get('svix-id');
    const svixTimestamp = request.headers.get('svix-timestamp');
    const svixSignature = request.headers.get('svix-signature');
    if (!svixId || !svixTimestamp || !svixSignature) return false;

    // 截取 whsec_ 前缀，将 Base64 主体解码为二进制字节数组
    const keyB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const binaryString = atob(keyB64);
    const keyBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      keyBytes[i] = binaryString.charCodeAt(i);
    }

    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const expected = await crypto.subtle.sign(
      'HMAC', key, new TextEncoder().encode(signedContent)
    );
    const expectedB64 = btoa(String.fromCharCode(...new Uint8Array(expected)));

    // svix-signature 在密钥轮换时可能含多个 `v1,<sig>`，以换行（或空格）分隔
    const parts = svixSignature.replace(/\s+/g, ' ').split(' ').filter(Boolean);
    return parts.some(part => {
      const idx = part.indexOf(',');
      if (idx < 0) return false;
      const [version, sig] = [part.slice(0, idx), part.slice(idx + 1)];
      return version === 'v1' && sig === expectedB64;
    });
  } catch (e) {
    console.error('[Webhook] signature verify error:', e);
    return false;
  }
}

/* ============================================================
 *  Email Status Check (Resend)
 *  ============================================================ */

async function handleCheckStatus(request, env, user) {
  const body = await request.json();
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0))].slice(0, 50);
  if (!Array.isArray(ids) || ids.length === 0) {
    return json({ error: 'ids array required' }, 400);
  }

  const RESEND_API_KEY = env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY not configured' }, 500);
  }

  const results = await mapWithConcurrency(ids, 5, async (localId) => {
    const sent = await env.DB.prepare(
      'SELECT id, resend_id, delivery_status FROM sent_emails WHERE id = ? AND user_id = ?'
    ).bind(localId, user.id).first();

    if (!sent || !sent.resend_id) {
      return { id: localId, delivery_status: sent?.delivery_status || 'unknown' };
    }

    try {
      const res = await fetchWithTimeout(`https://api.resend.com/emails/${sent.resend_id}`, {
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` }
      }, 10000);

      if (res.ok) {
        const emailData = await res.json();
        const status = resendStatus(emailData.last_event) || sent.delivery_status || 'sent';

        await env.DB.prepare(
          'UPDATE sent_emails SET delivery_status = ?, last_checked_at = datetime(\'now\') WHERE id = ?'
        ).bind(status, localId).run();

        return { id: localId, delivery_status: status };
      } else {
        return { id: localId, delivery_status: sent.delivery_status };
      }
    } catch {
      return { id: localId, delivery_status: sent.delivery_status };
    }
  });

  return json({ results });
}

/* ============================================================
 *  Auth Handlers
 *  ============================================================ */

async function handleAdminCheck(env) {
  // 一次查询同时读取初始化状态，避免前端把“无管理员”误判成“全新数据库”。
  const state = await env.DB.prepare(
    `SELECT
       EXISTS (SELECT 1 FROM users WHERE role = 'admin') AS admin_exists,
       EXISTS (SELECT 1 FROM users) AS initialized`
  ).first();
  return json({
    admin_exists: !!state?.admin_exists,
    initialized: !!state?.initialized,
    first_run: !state?.initialized,
  });
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
    'SELECT id FROM users LIMIT 1'
  ).first();
  if (existing) return json({ error: 'System already initialized' }, 403);

  if (!env.BOOTSTRAP_TOKEN) {
    return json({ error: 'Bootstrap token is not configured' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid request' }, 400);
  }

  const setupToken = String(body.setup_token || '').trim();
  if (!setupToken || !(await timingSafeEqual(setupToken, String(env.BOOTSTRAP_TOKEN)))) {
    return json({ error: 'Invalid bootstrap token' }, 403);
  }

  const adminUser = String(body.username || '').trim().toLowerCase();
  const adminPass = body.password;
  if (!adminUser || !adminPass) return json({ error: 'Username and password required' }, 400);
  if (!isValidNickname(adminUser)) {
    return json({ error: '昵称只能包含英文字母、数字、._-（最长 32 位）' }, 400);
  }
  if (typeof adminPass !== 'string' || adminPass.length < 6) {
    return json({ error: 'Password must be at least 6 characters' }, 400);
  }

  const emailAddress = `${adminUser}@${env.DOMAIN}`.toLowerCase();
  const passwordHash = await hashPassword(adminPass);

  // 与首次注册共用同一条原子条件：注册和 setup 并发时只允许一个成功。
  let result;
  try {
    result = await env.DB.prepare(
      `INSERT INTO users (username, password_hash, email_address, role, can_send, mailbox_limit)
       SELECT ?, ?, ?, 'admin', 1, 999
       WHERE NOT EXISTS (SELECT 1 FROM users)`
    ).bind(adminUser, passwordHash, emailAddress).run();
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return json({ error: 'System already initialized' }, 409);
    }
    throw err;
  }

  if (Number(result.meta?.changes || 0) !== 1) {
    return json({ error: 'System already initialized' }, 409);
  }

  // 创建默认邮箱
  await env.DB.prepare(
    'INSERT OR IGNORE INTO mailboxes (address, local_part, domain, can_login) VALUES (?, ?, ?, 1)'
  ).bind(emailAddress, adminUser, env.DOMAIN).run();

  const mb = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(emailAddress).first();
  if (mb) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO user_mailboxes (user_id, mailbox_id) VALUES (?, ?)'
    ).bind(result.meta.last_row_id, mb.id).run();
  }

  return json({ ok: true, username: adminUser, password: adminPass, email: emailAddress }, 201);
}

async function handleRegister(request, env) {
  const { username, password, invite } = await request.json();
  if (!username || !password) return json({ error: 'Username and password required' }, 400);
  if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

  const cleanUser = username.toLowerCase().trim();
  // 昵称即账号：仅标准英文/数字/._-，最长 32
  if (!isValidNickname(cleanUser)) {
    return json({ error: '昵称只能包含英文字母、数字、._-（最长 32 位）' }, 400);
  }

  const emailAddress = `${cleanUser}@${env.DOMAIN}`.toLowerCase();
  const initialized = await env.DB.prepare(
    'SELECT id FROM users LIMIT 1'
  ).first();
  if (!initialized) {
    return json({ error: 'Initial admin setup required', setup_required: true }, 403);
  }

  const passwordHash = await hashPassword(password);

  const setting = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'allow_registration'"
  ).first();
  if (setting?.value !== 'true') {
    return json({ error: 'Registration is closed' }, 403);
  }

  // 用一次 D1 batch 原子地“占用邀请码 + 创建用户”。UPDATE 只会成功一次，
  // 后续 INSERT 通过 changes() 确认本次占用确实成功，避免并发超用。
  const invCode = String(invite || '').trim().toUpperCase();
  if (!invCode) {
    return json({ error: '注册需要邀请码' }, 400);
  }

  let userId;
  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        'UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ? AND used_count < max_uses'
      ).bind(invCode),
      env.DB.prepare(
        `INSERT INTO users (username, password_hash, email_address, role, can_send, mailbox_limit)
         SELECT ?, ?, ?, 'user', 1, 10
         FROM invite_codes
         WHERE code = ? AND changes() = 1`
      ).bind(cleanUser, passwordHash, emailAddress, invCode),
    ]);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return json({ error: 'Username already exists' }, 409);
    throw err;
  }

  const insertResult = results[1];
  if (Number(insertResult?.meta?.changes || 0) !== 1) {
    return json({ error: '邀请码无效或已被使用完' }, 403);
  }
  userId = insertResult.meta.last_row_id;

  try {
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

    return json({ ok: true, email: emailAddress, admin: false }, 201);
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
    'SELECT id, username, email_address, password_hash, role, can_send, mailbox_limit FROM users WHERE username = ?'
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
    username: user.username,
    email_address: user.email_address,
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

  // 全站每日额度检查：所有用户当天经 Resend 发送的总量（含时区偏移）
  const siteLimitSetting = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'site_daily_limit'"
  ).first();
  const siteDailyLimit = parseInt(siteLimitSetting?.value || '100', 10);
  const siteTodayCount = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM sent_emails
     WHERE provider = 'resend' AND date(created_at, '+8 hours') = date('now', '+8 hours')`
  ).first();
  if (siteTodayCount.cnt >= siteDailyLimit) {
    return json({ error: `全站今日发件量已达 Resend 每日额度上限 (${siteDailyLimit}封)，请明天再试或联系管理员` }, 429);
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

    const res = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }, 15000);

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

async function fetchWithTimeout(resource, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const externalSignal = options.signal;
  let onAbort;
  if (externalSignal) {
    onAbort = () => controller.abort(externalSignal.reason || 'aborted');
    if (externalSignal.aborted) onAbort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal && onAbort) externalSignal.removeEventListener('abort', onAbort);
  }
}

function encodeCursor(value) {
  return btoa(JSON.stringify(value));
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value));
    if (!parsed || typeof parsed.timestamp !== 'string' || !Number.isInteger(Number(parsed.id))) return null;
    return { timestamp: parsed.timestamp, id: Number(parsed.id) };
  } catch {
    return null;
  }
}

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;

  const token = auth.slice(7);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.email_address, u.role, u.can_send, u.mailbox_limit
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).bind(token).first();

  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email_address: row.email_address,
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

// 比较初始化密钥时避免直接比较可观察的前缀差异。
async function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(a))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(b))),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let i = 0; i < Math.max(leftBytes.length, rightBytes.length); i++) {
    diff |= (leftBytes[i] || 0) ^ (rightBytes[i] || 0);
  }
  return diff === 0;
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
  // 新格式：pbkdf:iterations:salt:hash
  const parts = storedHash.split(':');
  if (parts.length < 3) return false;
  let iterations, salt, expected;
  if (parts[0] === 'pbkdf' && parts.length >= 4) {
    iterations = parseInt(parts[1], 10);
    salt = parts[2];
    expected = parts[3];
  } else {
    iterations = parseInt(parts[0], 10);
    salt = parts[1];
    expected = parts[2];
  }
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

// 昵称（即登录账号）：仅标准英文、数字、点/下划线/连字符，最长 32。
const NICKNAME_RE = /^[a-zA-Z0-9._-]{1,32}$/;
function isValidNickname(name) {
  return NICKNAME_RE.test(name);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function resolveCorsOrigin(request, env) {
  // 默认：未配置 ALLOWED_ORIGINS 时保持全开（向后兼容）
  const allowedRaw = env.ALLOWED_ORIGINS;
  if (!allowedRaw) {
    return '*';
  }

  const allowedSet = new Set(
    String(allowedRaw).split(',').map(s => s.trim()).filter(Boolean)
  );
  const origin = request.headers.get('Origin') || '';

  // 匹配则回显该来源
  if (allowedSet.has(origin)) {
    return origin;
  }
  // 未匹配的跨域请求：不返回 CORS 头（浏览器会拦截）
  return 'null';
}

function cors(response, allowedOrigin = '*') {
  const headers = new Headers(response.headers);
  if (allowedOrigin === 'null') {
    // 不放行跨域
    return new Response(response.body, { status: response.status, headers });
  }
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // 预检缓存 24h：跨源 + Authorization 必触发 OPTIONS，缓存后浏览器不再对每个请求预检，
  // 直接消灭日志里成堆的 204(几秒级延迟)。跨源配置时常变，留 24h 平衡灵活性与性能。
  headers.set('Access-Control-Max-Age', '86400');
  if (allowedOrigin !== '*') {
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Credentials', 'false');
  }
  return new Response(response.body, { status: response.status, headers });
}
