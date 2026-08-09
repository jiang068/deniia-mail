-- 邀请码表：管理员生成，用户需凭码注册
-- 使用: wrangler d1 execute mail-db --file=migrations/002_invite_codes.sql --remote

CREATE TABLE IF NOT EXISTS invite_codes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT NOT NULL UNIQUE,
    max_uses     INTEGER NOT NULL DEFAULT 1,
    used_count   INTEGER NOT NULL DEFAULT 0,
    created_by   INTEGER,
    created_at   TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);