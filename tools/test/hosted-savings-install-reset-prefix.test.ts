import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hostedSavingsResetPrefix } from './hosted-savings-install-reset-prefix';

const baseline = readFileSync(new URL('../../supabase/migrations/20260418000000_baseline.sql', import.meta.url), 'utf8');

test('extracts only the reviewed first-file closure and a temporary orders fixture', () => {
  const result = hostedSavingsResetPrefix(baseline);
  assert.equal(result.functions.length, 178);
  assert.equal(new Set(result.functions.map((entry) => entry.signature)).size, 178);
  assert.equal(result.functions.at(-1)?.signature, '"public"."validate_order_number"("text")');
  for (const entry of result.functions) assert.match(entry.bodyMd5, /^[a-f0-9]{32}$/);
  assert.match(result.orders, /^CREATE TEMP TABLE recovery_expected_orders/);
  assert.doesNotMatch(result.orders, /admin_query_performance|CREATE TABLE IF NOT EXISTS/);
});

test('rejects empty, truncated, appended and line-ending-modified baseline bytes', () => {
  for (const changed of ['', baseline.slice(0, -1), `${baseline}\n`, baseline.replaceAll('\n', '\r\n')]) {
    assert.throws(() => hostedSavingsResetPrefix(changed), /exact reviewed baseline bytes/);
  }
});
