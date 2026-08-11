-- Migration 003: Catch-all 白名单 —— 接收发往「系统中不存在邮箱」的信
-- 只有发件方域名后缀（后缀匹配）在白名单内的信才会被接收，
-- 否则直接丢弃（防刷量 / 防爆存储）。
-- 白名单条目可指定目标收件邮箱 target；未指定时用全局 catchall_target 兜底，
-- 目标邮箱为真实存在的 mailboxes.address。
-- 使用: wrangler d1 execute mail-db --file=migrations/003_catchall_whitelist.sql --remote

CREATE TABLE IF NOT EXISTS catchall_whitelist (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_suffix  TEXT    NOT NULL,            -- 发件方域名后缀（小写，如 example.com）
    target         TEXT,                        -- 目标收件邮箱；空则用全局 catchall_target
    note           TEXT,
    created_at     TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catchall_whitelist_suffix ON catchall_whitelist(domain_suffix);

-- 全局兜底目标邮箱（留空表示未配置，白名单命中但没有目标时无法投递）
INSERT OR IGNORE INTO settings (key, value) VALUES ('catchall_target', '');

-- catch-all 模式：off=关闭（默认，直接丢弃）/ whitelist=仅白名单与`*` / all=全放开（任意发件方）
INSERT OR IGNORE INTO settings (key, value) VALUES ('catchall_mode', 'off');