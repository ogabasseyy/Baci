import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { prepare } from './build.mjs';
import { authority, entrypoints } from './constants.mjs';

test('refuses repository, relative, nested and non-private temporary outputs before compiling', async () => {
  for (const destination of [
    '.',
    '/Users/mac/Baci-worktrees/cursor-savings-phase1',
    '/tmp/candidate',
    '/private/tmp/parent/candidate',
  ])
    await assert.rejects(prepare(destination), /unique immediate child/);
});

test('builds bounded candidates and seals their bytes while refusing deployment readiness', async () => {
  const destination = `/private/tmp/provider-build-test-${randomUUID()}`;
  try {
    const result = await prepare(destination);
    assert.equal(result.status, 'prepared-public-integration-required');
    assert.equal(result.publicHandlerIsNextStandaloneRelease, false);
    assert.equal(result.remoteActions, false);
    for (const [name, expected] of Object.entries(result.artifacts)) {
      const contents = await readFile(path.join(destination, name));
      assert.equal(
        createHash('sha256').update(contents).digest('hex'),
        expected
      );
    }
    const graph = JSON.parse(
      await readFile(path.join(destination, 'full-static-graph.json'))
    );
    assert.deepEqual(graph.entrypoints, entrypoints);
    assert.equal(graph.sources[authority.provider], authority.providerSha256);
    const worker = JSON.parse(
      await readFile(path.join(destination, 'workers/artifact.manifest.json'))
    );
    assert.equal(
      worker.sourceClosureSha256[authority.provider],
      authority.providerSha256
    );
    const bundle = await readFile(
      path.join(destination, 'public-checkout.cjs'),
      'utf8'
    );
    assert.match(bundle, /status === "abandoned"/);
    const inputs = JSON.parse(
      await readFile(path.join(destination, 'build-inputs.json'))
    );
    assert.match(inputs['pnpm-lock.yaml'], /^[a-f0-9]{64}$/);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
