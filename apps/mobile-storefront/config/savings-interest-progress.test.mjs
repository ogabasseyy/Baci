import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20261013194000_savings_interest_notification_progress.sql',
    import.meta.url
  ),
  'utf8'
);

test('progress uses credited goal amounts and excludes pending interest', () => {
  assert.match(
    migration,
    /goal.current_amount \* 100 \+ credited \+ primary_credited/
  );
  assert.match(migration, /posting.account = 'paid_interest'/);
  assert.match(migration, /receipt.net_kobo - coalesce\(reversal.amount, 0\)/);
  assert.match(migration, /operation.merchant_id = goal.merchant_id/);
  assert.match(migration, /operation.customer_id = goal.customer_id/);
  assert.match(migration, /receipt.merchant_id = goal.merchant_id/);
  assert.match(migration, /receipt.customer_id = goal.customer_id/);
  assert.match(migration, /LANGUAGE plpgsql VOLATILE/);
  assert.doesNotMatch(migration, /accrual|pending_kobo/);
});

test('both existing triggers gain dynamic wording without financial or access changes', () => {
  assert.match(migration, /piggyvest_primary.notify_paid_interest\(\)/);
  assert.match(migration, /savings_notifications.interest_recorded\(\)/);
  assert.match(migration, /'NEW.goal_id' ELSE 'operation.goal_id'/);
  assert.match(migration, /pg_get_functiondef\(signature\)/);
  assert.match(migration, /Unexpected interest notification progress baseline/);
  assert.match(migration, /FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(migration, /INSERT INTO|UPDATE public|GRANT /);
});
