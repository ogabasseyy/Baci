-- Support the merchant foreign key's cascading cleanup without scanning
-- dispatches belonging to every other merchant.
CREATE INDEX IF NOT EXISTS immediate_notification_dispatch_merchant_idx
  ON private.immediate_notification_dispatches (merchant_id);
