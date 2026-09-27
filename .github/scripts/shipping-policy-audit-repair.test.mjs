import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = '20260921100200_enforce_merchant_shipping_provider_policy';
const repair = '20260926130000_repair_shipping_provider_policy_audit';
function run({ history = [], fail = false, missing = false, tampered = false } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'shipping-applier-'));
  try {
    mkdirSync(`${temp}/bin`);
    mkdirSync(`${temp}/migrations`);
    copyFileSync(join(root, 'supabase/migrations', `${source}.sql`), `${temp}/migrations/${source}.sql`);
    if (tampered) writeFileSync(`${temp}/migrations/${source}.sql`, 'SELECT 1;');
    if (!missing) copyFileSync(join(root, 'supabase/migrations', `${repair}.sql`), `${temp}/migrations/${repair}.sql`);
    writeFileSync(`${temp}/bin/curl`, `#!/bin/bash
payload=$(cat)
printf '%s\\n' "$payload" >> "$QUERY_LOG"
if jq -e '.query | startswith("SELECT version, name")' >/dev/null <<< "$payload"; then
  printf '%s\\n' "$INITIAL_HISTORY"
elif [ "$FAIL_WRITE" = 1 ]; then
  printf '{"message":"audit insert failed"}\\n'
else
  printf '[]\\n'
fi
`);
    chmodSync(`${temp}/bin/curl`, 0o755);
    let error;
    try {
      execFileSync('bash', [join(root, '.github/scripts/apply-pending-migrations.sh')], {
        env: { ...process.env, PATH: `${temp}/bin:${process.env.PATH}`, MIGRATIONS_DIR: `${temp}/migrations`, SUPABASE_ACCESS_TOKEN: 'test', SUPABASE_PROJECT_REF: 'test', QUERY_LOG: `${temp}/queries`, INITIAL_HISTORY: JSON.stringify(history), FAIL_WRITE: fail ? '1' : '0' },
        stdio: 'pipe',
      });
    } catch (caught) { error = caught; }
    const queryText = readFileSync(`${temp}/queries`, 'utf8');
    // curl receives pretty-printed JSON, one complete object per request.
    const queries = queryText.split(/(?<=\})\n(?=\{)/).filter(value => value.trim()).map(value => JSON.parse(value).query);
    return { error, queries };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

test('runs the append-only repair before later migrations and records both identities atomically', () => {
  const { error, queries } = run();
  assert.equal(error, undefined);
  assert.equal(queries.length, 2);
  assert.ok(queries[1].startsWith('BEGIN;'));
  assert.ok(queries[1].endsWith('COMMIT;'));
  assert.match(queries[1], /DO \$shipping_backfill\$/);
  assert.match(queries[1], /VALUES \('20260921100200', 'enforce_merchant_shipping_provider_policy'/);
  assert.match(queries[1], /VALUES \('20260926130000', 'repair_shipping_provider_policy_audit'/);
});
test('rejects failed writes, missing repairs and changed original bytes', () => {
  for (const options of [{ fail: true }, { missing: true }, { tampered: true }]) {
    const { error, queries } = run(options);
    assert.ok(error);
    assert.equal(queries.length, options.fail ? 2 : 1);
  }
});
test('does not replay a fully reconciled repair', () => {
  const history = [
    { version: '20260921100200', name: 'enforce_merchant_shipping_provider_policy' },
    { version: '20260926130000', name: 'repair_shipping_provider_policy_audit' },
  ];
  const { error, queries } = run({ history });
  assert.equal(error, undefined);
  assert.equal(queries.length, 1);
});
