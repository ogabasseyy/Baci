import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  chunkGitObjectIdsBySize,
  MAX_GIT_OBJECT_BATCH_BYTES,
} from './source-manifest.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const run = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const node = (cwd, args) =>
  execFileSync(process.execPath, args, { cwd, encoding: 'utf8' });
const policy = readFileSync(join(here, 'policy.json'));
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
  for (const name of [
    'source-manifest.mjs',
    'canonical-json.mjs',
    'policy.schema.mjs',
    'source-manifest-git.mjs',
    'source-manifest-objects.mjs',
    'source-manifest-tree.mjs',
    'source-archive.mjs',
    'vps-ssh.sh',
  ]) {
    writeFileSync(
      join(root, 'infra/cwv-runner', name),
      readFileSync(join(here, name)),
      name === 'vps-ssh.sh' ? { mode: 0o755 } : undefined
    );
  }
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

test('chunks verified Git blobs by bytes instead of only entry count', () => {
  const sizes = new Map([
    ['a', { size: 60 }],
    ['b', { size: 60 }],
    ['c', { size: 60 }],
  ]);
  assert.deepEqual(chunkGitObjectIdsBySize(['a', 'b', 'c'], sizes, 700), [
    ['a', 'b'],
    ['c'],
  ]);
  assert.doesNotThrow(() =>
    chunkGitObjectIdsBySize(
      ['large'],
      new Map([['large', { size: MAX_GIT_OBJECT_BATCH_BYTES - 300 }]])
    )
  );
  assert.throws(
    () =>
      chunkGitObjectIdsBySize(
        ['too-large'],
        new Map([['too-large', { size: MAX_GIT_OBJECT_BATCH_BYTES }]])
      ),
    /exceeds batch size limit/
  );
});

test('hashes a large changed lockfile without treating it as an archive member', (t) => {
  const context = repository();
  t.after(() => rmSync(context.root, { recursive: true, force: true }));
  writeFileSync(
    join(context.root, 'pnpm-lock.yaml'),
    `${'x'.repeat(1_048_577)}\n`
  );
  run(context.root, ['add', 'pnpm-lock.yaml']);
  run(context.root, [
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@invalid',
    'commit',
    '-qm',
    'large lockfile',
  ]);
  context.head = run(context.root, ['rev-parse', 'HEAD']);
  const outputDir = mkdtempSync(join(tmpdir(), 'cwv-large-lockfile-'));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const output = {
    manifest: join(outputDir, 'manifest.json'),
    manifestDigest: join(outputDir, 'manifest.sha256'),
    archive: join(outputDir, 'source.tar'),
    archiveDigest: join(outputDir, 'source.tar.sha256'),
  };

  node(context.root, argumentsFor(context, 'freeze', output));
  const manifest = JSON.parse(readFileSync(output.manifest));
  assert(manifest.entries.some((entry) => entry.path === 'pnpm-lock.yaml'));
  assert(
    !manifest.sourceArchive.entries.some(
      (entry) => entry.path === 'pnpm-lock.yaml'
    )
  );
});

test('source archive accepts the current 529-file sealed projection', async (t) => {
  const context = repository();
  t.after(() => rmSync(context.root, { recursive: true, force: true }));
  const { createSourceArchive, verifySourceArchive } = await moduleFor(
    context.root
  );
  const entries = Array.from({ length: 529 }, (_, index) => {
    const bytes = Buffer.from(`member-${index}\n`);
    return {
      path: `infra/cwv-runner/member-${String(index).padStart(3, '0')}.mjs`,
      mode: '100644',
      blobSha256: createHash('sha256').update(bytes).digest('hex'),
      bytes,
    };
  });
  const archive = createSourceArchive(entries);
  verifySourceArchive(archive, entries);
});
