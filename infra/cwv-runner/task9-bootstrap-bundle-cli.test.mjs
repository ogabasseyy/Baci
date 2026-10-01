import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runTask9BootstrapBundleCli } from './task9-bootstrap-bundle-cli.mjs';

const flags = [
  '--cwd',
  '/repo',
  '--deployment-sha',
  'a'.repeat(40),
  '--workflow-id',
  '123',
  '--head-ref',
  'codex/h0',
  '--source-manifest',
  '/input/manifest',
  '--source-manifest-sha256',
  '/input/manifest.sha256',
  '--source-archive',
  '/input/source.tar',
  '--source-archive-sha256',
  '/input/source.sha256',
  '--node',
  '/input/node',
  '--node-archive',
  '/input/node.tar.xz',
  '--node-provenance',
  '/input/node-provenance.json',
  '--generation',
  '0',
  '--bundle-id',
  'task9-bundle-1',
  '--transaction-id',
  'task9-transaction-1',
  '--admission-id',
  'b'.repeat(64),
  '--authority-receipt',
  '/input/authority-receipt.json',
  '--authority-receipt-sha256',
  '/input/authority-receipt.sha256',
  '--output-root',
  '/private/tmp/baci-cwv-task9-bootstrap-task9-transaction-1',
  '--pr-metadata',
  '/input/pr-metadata.json',
  '--pr-metadata-sha256',
  '/input/pr-metadata.sha256',
  '--reviewed-pr-metadata-sha256',
  'd'.repeat(64),
];

test('composes closed scalar flags and returns canonical secret-free output', () => {
  let received;
  const result = runTask9BootstrapBundleCli(flags, {
    generate(input) {
      received = input;
      return {
        bundleId: input.bundleId,
        envelopeSha256: 'c'.repeat(64),
        outputRoot: input.outputRoot,
        transactionId: input.transactionId,
      };
    },
  });
  assert.equal(received.workflowId, 123);
  assert.equal(received.generation, 0);
  assert.equal(received.reviewedPrMetadataSha256, 'd'.repeat(64));
  assert.equal(
    result,
    `{"bundleId":"task9-bundle-1","envelopeSha256":"${'c'.repeat(64)}","outputRoot":"/private/tmp/baci-cwv-task9-bootstrap-task9-transaction-1","transactionId":"task9-transaction-1"}`
  );
});

test('direct CLI invocation through a symlink refuses the launcher bypass', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-cli-link-'));
  const link = join(root, 'task9-cli.mjs');
  try {
    symlinkSync(
      fileURLToPath(
        new URL('./task9-bootstrap-bundle-cli.mjs', import.meta.url)
      ),
      link
    );
    const result = spawnSync(process.execPath, [link], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'task9-bootstrap-bundle refused\n');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('direct invocation rejects missing, duplicate, and unknown flags', () => {
  const cli = fileURLToPath(
    new URL('./task9-bootstrap-bundle-cli.mjs', import.meta.url)
  );
  for (const argv of [
    flags.slice(2),
    [...flags.slice(0, -2), '--cwd', '/other'],
    [...flags, '--json', '{}'],
    [...flags.slice(0, -2), 'constructor', '/private/tmp/unsafe'],
    flags.map((value, index) => (index === 3 ? '' : value)),
  ]) {
    const result = spawnSync(process.execPath, [cli, ...argv], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'task9-bootstrap-bundle refused\n');
  }
});
