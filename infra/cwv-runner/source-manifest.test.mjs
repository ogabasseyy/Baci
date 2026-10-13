import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  sourceManifestBytes,
  TASK9_SOURCE_MANIFEST_MAX_BYTES,
} from './source-manifest.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const run = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const node = (cwd, args) =>
  execFileSync(process.execPath, args, { cwd, encoding: 'utf8' });
const rejectedNode = (cwd, args) =>
  spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
const policy = readFileSync(join(here, 'policy.json'));
const policyValue = JSON.parse(policy);

const moduleFor = (root) =>
  import(
    pathToFileURL(join(root, 'infra/cwv-runner/source-manifest.mjs')).href
  );

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'cwv-source-'));
  mkdirSync(join(root, 'infra/cwv-runner'), { recursive: true });
  writeFileSync(join(root, 'infra/cwv-runner/policy.json'), policy);
  writeFileSync(join(root, 'infra/cwv-runner/a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(root, 'README.md'), 'base\n');
  symlinkSync('README.md', join(root, 'unrelated-link'));
  writeFileSync(
    join(root, 'infra/cwv-runner/source-manifest.mjs'),
    readFileSync(join(here, 'source-manifest.mjs'))
  );
  for (const name of [
    'canonical-json.mjs',
    'policy.schema.mjs',
    'source-manifest-git.mjs',
    'source-manifest-objects.mjs',
    'source-manifest-tree.mjs',
  ])
    writeFileSync(
      join(root, 'infra/cwv-runner', name),
      readFileSync(join(here, name))
    );
  writeFileSync(
    join(root, 'infra/cwv-runner/source-archive.mjs'),
    readFileSync(join(here, 'source-archive.mjs'))
  );
  writeFileSync(
    join(root, 'infra/cwv-runner/vps-ssh.sh'),
    readFileSync(join(here, 'vps-ssh.sh')),
    { mode: 0o755 }
  );
  run(root, ['init', '-q']);
  run(root, ['add', '.']);
  run(root, [
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@invalid',
    'commit',
    '-qm',
    'base',
  ]);
  const base = run(root, ['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'infra/cwv-runner/a.mjs'), 'export const a = 2;\n');
  writeFileSync(join(root, 'infra/cwv-runner/b.sh'), '#!/bin/sh\necho b\n', {
    mode: 0o755,
  });
  writeFileSync(join(root, 'README.md'), 'changed\n');
  run(root, ['add', '.']);
  run(root, [
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@invalid',
    'commit',
    '-qm',
    'head',
  ]);
  return { root, base, head: run(root, ['rev-parse', 'HEAD']) };
}

function argumentsFor(context, command, output) {
  const names =
    command === 'freeze'
      ? ['--output', output.manifest, '--output-digest', output.manifestDigest]
      : ['--input', output.manifest, '--input-digest', output.manifestDigest];
  return [
    join(context.root, 'infra/cwv-runner/source-manifest.mjs'),
    command,
    '--pr-number',
    '7',
    '--reviewed-head',
    context.head,
    '--base',
    context.base,
    '--merge',
    context.head,
    ...names,
    '--source-archive',
    output.archive,
    '--source-archive-digest',
    output.archiveDigest,
  ];
}

test('freeze-preflight binds only the reviewed Git tree and rejects a mutable policy', (t) => {
  const context = repository();
  t.after(() => rmSync(context.root, { recursive: true, force: true }));
  const outputDir = mkdtempSync(join(tmpdir(), 'cwv-preflight-'));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const output = {
    manifest: join(outputDir, 'manifest.json'),
    manifestDigest: join(outputDir, 'manifest.sha256'),
    archive: join(outputDir, 'source.tar'),
    archiveDigest: join(outputDir, 'source.tar.sha256'),
  };
  writeFileSync(
    join(context.root, 'infra/cwv-runner/policy.json'),
    JSON.stringify({ authority: { deploymentMarker: 'mutable-working-tree' } })
  );
  const result = spawnSync(
    process.execPath,
    [
      join(context.root, 'infra/cwv-runner/source-manifest.mjs'),
      'freeze-preflight',
      '--pr-number',
      '7',
      '--reviewed-head',
      context.head,
      '--base',
      context.base,
      '--output',
      output.manifest,
      '--output-digest',
      output.manifestDigest,
      '--source-archive',
      output.archive,
      '--source-archive-digest',
      output.archiveDigest,
    ],
    { cwd: context.root, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(output.manifest, 'utf8'));
  assert.equal(manifest.schemaVersion, 'preflight-v1');
  assert.equal(manifest.reviewedHeadSha, context.head);
  assert.equal(
    manifest.authority.deploymentMarker,
    policyValue.authority.deploymentMarker
  );
});

test('uses a handoff limit above the legacy one-megabyte manifest cap', () => {
  assert.doesNotThrow(() =>
    sourceManifestBytes({ value: 'x'.repeat(1_048_577) })
  );
  assert.throws(
    () =>
      sourceManifestBytes({
        value: 'x'.repeat(TASK9_SOURCE_MANIFEST_MAX_BYTES),
      }),
    /source manifest exceeds size limit/
  );
});

test('freeze and verify bind a sorted full source archive while retaining outside diff rows', (t) => {
  const context = repository();
  t.after(() => rmSync(context.root, { recursive: true, force: true }));
  const outputDir = mkdtempSync(join(tmpdir(), 'cwv-output-'));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const output = {
    manifest: join(outputDir, 'manifest.json'),
    manifestDigest: join(outputDir, 'manifest.sha256'),
    archive: join(outputDir, 'source.tar'),
    archiveDigest: join(outputDir, 'source.tar.sha256'),
  };
  node(context.root, argumentsFor(context, 'freeze', output));
  node(context.root, argumentsFor(context, 'verify', output));
  const manifest = JSON.parse(readFileSync(output.manifest));
  assert(manifest.entries.some((entry) => entry.path === 'README.md'));
  assert(
    !manifest.sourceArchive.entries.some((entry) => entry.path === 'README.md')
  );
  assert.deepEqual(
    [...manifest.sourceArchive.entries].map((entry) => entry.path),
    [...manifest.sourceArchive.entries].map((entry) => entry.path).sort()
  );
});

test('freeze rejects a symlink leaf rather than omitting it from the archive', (t) => {
  const context = repository();
  t.after(() => rmSync(context.root, { recursive: true, force: true }));
  symlinkSync('a.mjs', join(context.root, 'infra/cwv-runner/link.mjs'));
  run(context.root, ['add', '-A']);
  run(context.root, [
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@invalid',
    'commit',
    '-qm',
    'symlink',
  ]);
  context.head = run(context.root, ['rev-parse', 'HEAD']);
  const outputDir = mkdtempSync(join(tmpdir(), 'cwv-output-'));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const output = {
    manifest: join(outputDir, 'manifest.json'),
    manifestDigest: join(outputDir, 'manifest.sha256'),
    archive: join(outputDir, 'source.tar'),
    archiveDigest: join(outputDir, 'source.tar.sha256'),
  };
  assert.notEqual(
    rejectedNode(context.root, argumentsFor(context, 'freeze', output)).status,
    0
  );
});

test('archive verifier rejects checksum, padding, and hidden trailing bytes', async (t) => {
  const context = repository();
  t.after(() => rmSync(context.root, { recursive: true, force: true }));
  const { createSourceArchive, verifySourceArchive } = await moduleFor(
    context.root
  );
  const entries = [
    {
      path: 'infra/cwv-runner/a.mjs',
      mode: '100644',
      blobSha256: 'x',
      bytes: Buffer.from('body'),
    },
  ];
  entries[0].blobSha256 = createHash('sha256')
    .update(entries[0].bytes)
    .digest('hex');
  const archive = createSourceArchive(entries);
  verifySourceArchive(archive, entries);
  const badChecksum = Buffer.from(archive);
  badChecksum[148] ^= 1;
  const badPadding = Buffer.from(archive);
  badPadding[516] = 1;
  for (const broken of [
    badChecksum,
    badPadding,
    Buffer.concat([archive, Buffer.from([1])]),
  ])
    assert.throws(() => verifySourceArchive(broken, entries));
});
