import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const repair = '20260907111036_repair_sales_exclusion_wallet_version_collision';
const sales = '20260903120000_exclude_repair_pickup_from_merchant_sales';
const wallet = 'guard_merchant_wallet_paystack_dva_alias';

function run(history, { missingRepair = false, failWrite = false } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'sales-collision-'));
  try {
    mkdirSync(join(temp, 'bin'));
    mkdirSync(join(temp, 'migrations'));
    copyFileSync(join(root, 'supabase/migrations', `${sales}.sql`), join(temp, 'migrations', `${sales}.sql`));
    if (!missingRepair) copyFileSync(join(root, 'supabase/migrations', `${repair}.sql`), join(temp, 'migrations', `${repair}.sql`));
    writeFileSync(join(temp, 'migrations/20260904110100_followup.sql'), "SELECT 'followup';\n");
    writeFileSync(join(temp, 'bin/curl'), `#!/bin/bash
payload=$(cat)
printf '%s\\n' "$payload" | jq -c . >> "$QUERY_LOG"
if jq -e '.query | startswith("SELECT version, name")' >/dev/null <<< "$payload"; then
  printf '%s\\n' "$INITIAL_HISTORY"
elif [ "$FAIL_WRITE" = 1 ]; then
  exit 22
else
  printf '[]\\n'
fi
`);
    chmodSync(join(temp, 'bin/curl'), 0o755);
    let error;
    try {
      execFileSync('bash', [join(root, '.github/scripts/apply-pending-migrations.sh')], {
        env: { ...process.env, PATH: `${temp}/bin:${process.env.PATH}`, MIGRATIONS_DIR: `${temp}/migrations`, SUPABASE_ACCESS_TOKEN: 'test', SUPABASE_PROJECT_REF: 'test', QUERY_LOG: `${temp}/queries`, INITIAL_HISTORY: JSON.stringify(history), FAIL_WRITE: failWrite ? '1' : '0' },
        stdio: 'pipe',
      });
    } catch (caught) { error = caught; }
    const queries = readFileSync(`${temp}/queries`, 'utf8').trim().split('\n').map(line => JSON.parse(line).query);
    return { error, queries };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

test('repairs the occupied sales version before dependent migrations without rewriting history', () => {
  const { error, queries } = run([{ version: '20260903120000', name: wallet }]);
  assert.equal(error, undefined);
  const writes = queries.slice(1);
  assert.equal(writes.length, 2);
  assert.match(writes[0], /CREATE OR REPLACE FUNCTION public.is_merchant_sales_transaction/);
  assert.match(writes[0], /20260907111036/);
  assert.match(writes[1], /SELECT 'followup'/);
  assert.doesNotMatch(writes.join('\n'), /(?:UPDATE|DELETE FROM) supabase_migrations/);
  assert.doesNotMatch(writes.join('\n'), /VALUES \('20260903120000'/);
});

test('does not replay a completed repair', () => {
  const { error, queries } = run([{ version: '20260903120000', name: wallet }, { version: '20260907111036', name: 'repair_sales_exclusion_wallet_version_collision' }]);
  assert.equal(error, undefined);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /SELECT 'followup'/);
});

test('refuses an unknown recorded name instead of accepting an alias', () => {
  const { error, queries } = run([{ version: '20260903120000', name: 'unexpected' }]);
  assert.ok(error);
  assert.equal(queries.length, 1);
});

test('refuses a missing repair before running dependent SQL', () => {
  const { error, queries } = run([{ version: '20260903120000', name: wallet }], { missingRepair: true });
  assert.ok(error);
  assert.equal(queries.length, 1);
});

test('does not continue after the repair transaction fails', () => {
  const { error, queries } = run([{ version: '20260903120000', name: wallet }], { failWrite: true });
  assert.ok(error);
  assert.equal(queries.length, 2);
  assert.doesNotMatch(queries[1], /SELECT 'followup'/);
});
