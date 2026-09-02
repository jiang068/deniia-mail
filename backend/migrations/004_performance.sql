-- 详情正文在邮件接收时解析并缓存，避免每次打开都重复解析 raw MIME。
ALTER TABLE messages ADD COLUMN html_content TEXT;
ALTER TABLE messages ADD COLUMN text_content TEXT;
ALTER TABLE sent_emails ADD COLUMN delivery_event_at TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_mailbox_read ON messages(mailbox_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received_id ON messages(mailbox_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_from_date ON sent_emails(from_addr, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_status_date ON sent_emails(delivery_status, created_at DESC);

-- Svix event id 幂等表：Resend 重试同一事件时不会重复写状态。
CREATE TABLE IF NOT EXISTS webhook_events (
    event_id    TEXT PRIMARY KEY,
    event_type  TEXT NOT NULL,
    resend_id   TEXT,
    event_at    TEXT NOT NULL,
    received_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_resend ON webhook_events(resend_id, event_at DESC);
