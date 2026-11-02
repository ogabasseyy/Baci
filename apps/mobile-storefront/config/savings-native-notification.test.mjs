import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('live activity opens the named savings goal and uses black with red progress', () => {
  const attributes = read('../ios/SavingsActivity/SavingsAttributes.swift');
  const widget = read('../ios/SavingsActivity/SavingsActivityWidget.swift');
  assert.match(attributes, /name: "savingsGoalId", value: goalId/);
  assert.match(attributes, /name: "action", value: "savings"/);
  assert.match(widget, /activityBackgroundTint\(\.black\)/);
  assert.match(widget, /Color\(red: 0\.88, green: 0\.12, blue: 0\.15\)/);
  assert.match(widget, /ProgressView.*\.tint\(accent\)/);
  assert.match(widget, /widgetURL\(context.attributes.progressURL\)/);
  assert.match(widget, /context.isStale/);
});

test('interest copy keeps net amounts, deduplication and reversal handling', () => {
  const sql = read(
    '../../../supabase/migrations/20261013123000_savings_interest_notification_copy.sql'
  );
  assert.match(sql, /NEW.net_kobo::numeric\/100/);
  assert.match(sql, /NEW.amount_kobo::numeric \/ 100/);
  assert.equal(sql.split('Your savings just grew 🎉').length - 1, 2);
  assert.match(sql, /'interest:' \|\| operation.id/);
  assert.match(sql, /operation.reference_id/);
  assert.match(sql, /voided_at = now\(\)/);
  assert.doesNotMatch(
    sql,
    /UPDATE public.customer_wallets|INSERT INTO.*postings/
  );
});
