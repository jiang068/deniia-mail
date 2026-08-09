-- Migration 001: Add delivery tracking to sent_emails
-- Run: wrangler d1 execute mail-db --file=migrations/001_add_delivery_status.sql --remote

ALTER TABLE sent_emails ADD COLUMN delivery_status TEXT DEFAULT 'sending';
ALTER TABLE sent_emails ADD COLUMN last_checked_at TEXT;
UPDATE sent_emails SET delivery_status = 'sent' WHERE delivery_status IS NULL;