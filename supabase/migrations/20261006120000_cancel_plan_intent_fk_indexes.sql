-- Follow-up to 20260912160000_cancel_plan_preparation: that table indexes
-- only goal_id, so parent-row updates/deletes on merchants/customers must
-- scan the whole cancellation-intent table to enforce the merchant_id and
-- customer_id foreign keys. Migrations are append-only, so the indexes land
-- here rather than editing the original migration.
CREATE INDEX IF NOT EXISTS piggyvest_cancel_plan_intents_merchant_idx
  ON piggyvest_cancel_plan.intents (merchant_id);
CREATE INDEX IF NOT EXISTS piggyvest_cancel_plan_intents_customer_idx
  ON piggyvest_cancel_plan.intents (customer_id);
