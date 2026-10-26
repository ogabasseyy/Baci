import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(
  new URL('./run-piggyvest-ledger-sql-local.sh', import.meta.url)
);

test('applies deferred balance authority as postgres before ledger guards', () => {
  const runner = readFileSync(runnerPath, 'utf8');
  const migrationsLoop = runner.indexOf('for migration in');
  const migrationsLoopEnd = runner.indexOf('\ndone', migrationsLoop);
  const initdb = runner.indexOf(
    'initdb" -D "$temp_dir/data" -A trust -U postgres'
  );
  const psql = runner.indexOf(
    'psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -h "$socket_dir" -p 55449 -U postgres'
  );
  const deferredAuthorityMigration = runner.indexOf(
    '20261003160000_piggyvest_ledger_deferred_balance_authority.sql'
  );
  const acceptanceFixture = runner.indexOf(
    'piggyvest-savings-ledger-acceptance.sql'
  );
  const guardsFixture = runner.indexOf('piggyvest-savings-ledger-guards.sql');

  assert.ok(
    initdb > 0 && initdb < migrationsLoop && psql > 0 && psql < migrationsLoop,
    'the local cluster and harness connection use the existing postgres owner'
  );
  assert.ok(
    runner.includes('20260912120[0-5]00_*.sql') &&
      /"\$\{psql\[@\]\}" -f "\$migration"/.test(runner),
    'the existing balance-check function is created with postgres ownership'
  );
  assert.ok(
    deferredAuthorityMigration > migrationsLoopEnd &&
      deferredAuthorityMigration < acceptanceFixture &&
      deferredAuthorityMigration < guardsFixture &&
      /"\$\{psql\[@\]\}" -f "\$worktree\/supabase\/migrations\/20261003160000_piggyvest_ledger_deferred_balance_authority\.sql"/.test(
        runner
      ),
    'the existing deferred-authority migration runs as postgres before acceptance and guard fixtures'
  );
  const acceptanceSql = readFileSync(
    join(dirname(runnerPath), 'piggyvest-savings-ledger-acceptance.sql'),
    'utf8'
  );
  assert.match(
    acceptanceSql,
    /'30000000-0000-4000-8000-000000000001',\s*SESSION_USER,\s*true\)/,
    'the synthetic binding authorizes the actual local harness session user'
  );
});
