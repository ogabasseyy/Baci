import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

test('POD fixture changes trigger its database CI scope', () => {
  const filters = parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  assert.ok(filters.quiz_db.includes('tools/test/order-pod-policy-local.test.mjs'));
});
