import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedSavingsBootstrap } from './hosted-savings-bootstrap';

type Dependencies = NonNullable<Parameters<typeof hostedSavingsBootstrap>[2]>;

function fixture() {
  const sources = Array.from({ length: 130 }, (_, index) => ({
    repositoryPath: `supabase/migrations/${index}.sql`,
    receiptId: String(index),
    sha256: 'a'.repeat(64),
  }));
  const calls: Parameters<Dependencies['run']>[0][] = [];
  const verified = {
    bootstrapSources: sources.slice(0, 125),
    postReplaySources: [],
    manifest: { pendingSources: [] },
  } as unknown as Awaited<ReturnType<Dependencies['verify']>>;
  const runtime: Dependencies = {
    verify: async () => verified,
    materialize: () => sources,
    run: async (options) => {
      calls.push(options);
      return {} as Awaited<ReturnType<Dependencies['run']>>;
    },
  };
  return { runtime, calls, sources, verified };
}

test('plan starts with first source and never executes a database runner', async () => {
  const { runtime, calls } = fixture();
  const plan = await hostedSavingsBootstrap(['--plan'], '/repository', runtime);
  assert.equal(plan.firstSource, 'supabase/migrations/0.sql');
  assert.equal(plan.historicalCountIncludingBootstrap, 130);
  assert.equal(plan.resumeSupported, false);
  assert.equal(calls.length, 0);
});

test('fresh runs use owned engine bootstrap and force current-tree applier with SQL checks', async () => {
  const { runtime, calls } = fixture();
  await hostedSavingsBootstrap(
    ['--fresh-disposable-local'],
    '/repository',
    runtime
  );
  assert.deepEqual(calls, [
    {
      repositoryRoot: '/repository',
      mode: 'chronological',
      pendingRepairState: 'materialized',
      comparisonMode: 'classify',
      productionOldCancellationProof: 'skip',
      sqlChecks: ['tools/test/piggyvest-full-schema-check.sql'],
    },
  ]);
});

test('rejects resume, offsets, destinations and extra options before verification', async () => {
  const { runtime } = fixture();
  runtime.verify = async () => {
    throw new Error('must not verify');
  };
  for (const args of [
    [],
    ['--resume'],
    ['--fresh-disposable-local', '--offset=1087'],
    ['--plan', 'postgres://remote/db'],
    ['--database-url=postgres://localhost/db'],
  ]) {
    await assert.rejects(
      hostedSavingsBootstrap(args, '/repository', runtime),
      /resume are forbidden/
    );
  }
});

test('malformed manifest stops before materialization and execution', async () => {
  const { runtime, calls } = fixture();
  runtime.verify = async () => {
    throw new Error('malformed manifest');
  };
  runtime.materialize = () => {
    throw new Error('must not materialize');
  };
  await assert.rejects(
    hostedSavingsBootstrap(['--plan'], '/repository', runtime),
    /malformed manifest/
  );
  assert.equal(calls.length, 0);
});

test('rejects a resumed or hash-mismatched bootstrap prefix', async () => {
  for (const mutation of ['offset', 'hash']) {
    const { runtime, sources, calls } = fixture();
    runtime.materialize = () =>
      mutation === 'offset'
        ? sources.slice(1)
        : sources.map((source, index) =>
            index === 0 ? { ...source, sha256: 'b'.repeat(64) } : source
          );
    await assert.rejects(
      hostedSavingsBootstrap(
        ['--fresh-disposable-local'],
        '/repository',
        runtime
      ),
      /prefix mismatch/
    );
    assert.equal(calls.length, 0);
  }
});

test('runner failure propagates without retry or implicit resume', async () => {
  const { runtime } = fixture();
  let attempts = 0;
  runtime.run = async () => {
    attempts += 1;
    throw new Error('SQL failed');
  };
  await assert.rejects(
    hostedSavingsBootstrap(
      ['--fresh-disposable-local'],
      '/repository',
      runtime
    ),
    /SQL failed/
  );
  assert.equal(attempts, 1);
});
