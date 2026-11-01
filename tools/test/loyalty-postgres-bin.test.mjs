import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePostgresBin } from './loyalty-postgres-bin.mjs';

test('resolves PostgreSQL binaries without a platform-specific default', () => {
  const run = () => ({ status: 0, stdout: '/usr/lib/postgresql/17/bin\n' });
  assert.equal(
    resolvePostgresBin({ args: [], env: {}, run }),
    '/usr/lib/postgresql/17/bin'
  );
  assert.equal(
    resolvePostgresBin({ args: [], env: { PG_BINDIR: '/custom/bin' }, run }),
    '/custom/bin'
  );
  assert.equal(
    resolvePostgresBin({
      args: ['--postgres-bin=/explicit'],
      env: { PG_BINDIR: '/custom/bin' },
      run,
    }),
    '/explicit'
  );
  assert.equal(
    resolvePostgresBin({ args: [], env: {}, run: () => ({ status: 1 }) }),
    ''
  );
});
