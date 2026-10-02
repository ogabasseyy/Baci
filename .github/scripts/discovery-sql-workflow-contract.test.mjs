import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
const filters = readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8');
const databaseFilter = filters.split(/^quiz_db:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
const patterns = [...databaseFilter.matchAll(/^\s+- '([^']+)'/gm)].map((match) => match[1]);
const fixtures = [...workflow.matchAll(/--sql-check\s+(supabase\/tests\/(?:product_discovery_|mcp_search_)[\w-]+\.sql)/g)]
  .map((match) => match[1]);

function matches(pattern, path) {
  const expression = pattern.split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${expression}$`).test(path);
}

test('every executed discovery SQL fixture independently triggers database replay', () => {
  assert.ok(fixtures.length > 10, 'expected the discovery runtime fixtures');
  for (const fixture of fixtures) {
    assert.ok(patterns.some((pattern) => matches(pattern, fixture)), `${fixture} must trigger quiz_db`);
  }
});

test('new focused discovery and option fixtures also trigger database replay', () => {
  for (const fixture of ['product_discovery_future_contract.sql', 'mcp_search_future_window.sql']) {
    assert.ok(patterns.some((pattern) => matches(pattern, `supabase/tests/${fixture}`)));
  }
});
