import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { executePreviewGate } from './preview-gate-cli.mjs';

test('reads the staged manifest and runs readiness and smoke for a dropped ref', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preview-gate-test-'));
  const file = join(dir, 'manifest.json');
  await writeFile(
    file,
    JSON.stringify({ refs: [], skipped: [{ reason: 'missing' }] })
  );
  const events = [];
  const result = await executePreviewGate({
    manifestPath: file,
    origin: 'https://baci-abc-basseys-projects-d7395611.vercel.app',
    runner: '/trusted/runner',
    automationSecret: 'fixture',
    inspect: async () => {
      events.push('inspect');
      return 'READY';
    },
    smoke: async () => {
      events.push('smoke');
    },
  });
  assert.equal(result, 'passed');
  assert.deepEqual(events, ['inspect', 'smoke']);
});

test('refuses to generate a project bypass secret automatically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preview-gate-test-'));
  const file = join(dir, 'manifest.json');
  await writeFile(
    file,
    JSON.stringify({ refs: [], skipped: [{ reason: 'missing' }] })
  );
  await assert.rejects(
    executePreviewGate({
      manifestPath: file,
      origin: 'https://baci-abc-basseys-projects-d7395611.vercel.app',
      runner: '/trusted/runner',
      automationSecret: '',
      inspect: async () => 'READY',
      smoke: async () => {},
    }),
    /configured.*bypass/i
  );
});

test('fails closed if the manifest is missing or invalid', async () => {
  await assert.rejects(
    executePreviewGate({
      manifestPath: '/missing/manifest',
      origin: 'https://baci-abc-basseys-projects-d7395611.vercel.app',
      runner: '/trusted/runner',
    })
  );
});
