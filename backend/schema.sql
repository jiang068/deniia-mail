-- D1 数据库初始化脚本
-- 使用: wrangler d1 execute mail-db --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT    NOT NULL UNIQUE,
    password_hash  TEXT,
    role           TEXT    NOT NULL DEFAULT 'user',
    email_address  TEXT    NOT NULL,
    can_send       INTEGER NOT NULL DEFAULT 1,
    mailbox_limit  INTEGER NOT NULL DEFAULT 10,
    created_at     TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    token       TEXT    NOT NULL UNIQUE,
    created_at  TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mailboxes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    address         TEXT    NOT NULL UNIQUE,
    local_part      TEXT    NOT NULL,
    domain          TEXT    NOT NULL,
    password_hash   TEXT,
    can_login       INTEGER DEFAULT 0,
    created_at      TEXT    DEFAULT (datetime('now')),
    last_accessed_at TEXT,
    forward_to      TEXT    DEFAULT NULL,
    is_favorite     INTEGER DEFAULT 0,
    is_pinned       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mailbox_id      INTEGER NOT NULL,
    sender          TEXT    NOT NULL,
    to_addrs        TEXT    NOT NULL DEFAULT '',
    subject         TEXT    NOT NULL DEFAULT '(No Subject)',
    preview         TEXT,
    raw_content     TEXT,
    html_content    TEXT,
    text_content    TEXT,
    verification_code TEXT,
    received_at     TEXT    DEFAULT (datetime('now')),
    is_read         INTEGER DEFAULT 0,
    FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id)
);

CREATE TABLE IF NOT EXISTS user_mailboxes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    mailbox_id  INTEGER NOT NULL,
    created_at  TEXT    DEFAULT (datetime('now')),
    is_pinned   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, mailbox_id),
    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sent_emails (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    resend_id       TEXT,
    from_addr       TEXT    NOT NULL,
    to_addrs        TEXT    NOT NULL,
    subject         TEXT    NOT NULL,
    text_content    TEXT,
    status          TEXT    DEFAULT 'sent',
    delivery_status TEXT    DEFAULT 'sending',
    last_checked_at TEXT,
    delivery_event_at TEXT,
    created_at      TEXT    DEFAULT (datetime('now')),
    provider        TEXT    NOT NULL DEFAULT 'resend',
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS invite_codes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT NOT NULL UNIQUE,
    max_uses     INTEGER NOT NULL DEFAULT 1,
    used_count   INTEGER NOT NULL DEFAULT 0,
    created_by   INTEGER,
    created_at   TEXT    DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_registration', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_send_limit', '50');

CREATE INDEX IF NOT EXISTS idx_mailboxes_address ON mailboxes(address);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received ON messages(mailbox_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_read ON messages(mailbox_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received_id ON messages(mailbox_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_user_mailboxes_user ON user_mailboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_mailboxes_mailbox ON user_mailboxes(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sent_emails_user_date ON sent_emails(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_from ON sent_emails(from_addr);
CREATE INDEX IF NOT EXISTS idx_sent_emails_from_date ON sent_emails(from_addr, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_status_date ON sent_emails(delivery_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_resend ON sent_emails(resend_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);

CREATE TABLE IF NOT EXISTS webhook_events (
    event_id    TEXT PRIMARY KEY,
    event_type  TEXT NOT NULL,
    resend_id   TEXT,
    event_at    TEXT NOT NULL,
    received_at TEXT DEFAULT (datetime('now'))
);
