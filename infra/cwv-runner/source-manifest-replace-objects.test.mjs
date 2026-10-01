import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { freezeSourceManifest } from './source-manifest.mjs';

const here = new URL('.', import.meta.url);
const root = fileURLToPath(new URL('../../', here));
const git = (cwd, args, input) =>
  execFileSync('/usr/bin/git', args, { cwd, input, encoding: 'utf8' }).trim();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('ignores Git replacement refs while freezing the literal reviewed commit', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'cwv-replace-objects-'));
  const output = mkdtempSync(join(tmpdir(), 'cwv-replace-output-'));
  try {
    mkdirSync(join(fixture, 'infra/cwv-runner'), { recursive: true });
    for (const name of [
      'policy.json',
      'canonical-json.mjs',
      'policy.schema.mjs',
      'source-archive.mjs',
      'source-manifest.mjs',
      'source-manifest-git.mjs',
      'source-manifest-objects.mjs',
      'source-manifest-tree.mjs',
    ])
      writeFileSync(
        join(fixture, 'infra/cwv-runner', name),
        readFileSync(join(root, 'infra/cwv-runner', name))
      );
    writeFileSync(
      join(fixture, 'infra/cwv-runner', 'vps-ssh.sh'),
      readFileSync(join(root, 'infra/cwv-runner', 'vps-ssh.sh'))
    );
    chmodSync(join(fixture, 'infra/cwv-runner', 'vps-ssh.sh'), 0o755);
    writeFileSync(join(fixture, 'infra/cwv-runner', 'a.mjs'), 'real\n');
    git(fixture, ['init', '-q']);
    git(fixture, ['add', '.']);
    git(fixture, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@invalid',
      'commit',
      '-qm',
      'base',
    ]);
    const reviewed = git(fixture, ['rev-parse', 'HEAD']);
    writeFileSync(join(fixture, 'infra/cwv-runner/a.mjs'), 'replacement\n');
    git(fixture, ['add', '.']);
    git(fixture, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@invalid',
      'commit',
      '-qm',
      'replacement',
    ]);
    const replacement = git(fixture, ['rev-parse', 'HEAD']);
    git(fixture, ['replace', reviewed, replacement]);
    const manifestPath = join(output, 'manifest.json');
    const digestPath = join(output, 'manifest.sha256');
    const archivePath = join(output, 'source.tar');
    const archiveDigestPath = join(output, 'source.tar.sha256');
    freezeSourceManifest({
      cwd: fixture,
      prNumber: 1,
      reviewedHeadSha: reviewed,
      baseSha: reviewed,
      mergeSha: reviewed,
      output: manifestPath,
      outputDigest: digestPath,
      sourceArchive: archivePath,
      sourceArchiveDigest: archiveDigestPath,
    });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.sourceArchive.entries.find(
      ({ path }) => path === 'infra/cwv-runner/a.mjs'
    );
    assert.equal(entry.blobSha256, sha256(Buffer.from('real\n')));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});

test('refuses a loose Git object whose bytes do not hash to its named id', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'cwv-object-integrity-'));
  const output = mkdtempSync(join(tmpdir(), 'cwv-object-output-'));
  try {
    mkdirSync(join(fixture, 'infra/cwv-runner'), { recursive: true });
    for (const name of [
      'policy.json',
      'canonical-json.mjs',
      'policy.schema.mjs',
      'source-archive.mjs',
      'source-manifest.mjs',
    ])
      writeFileSync(
        join(fixture, 'infra/cwv-runner', name),
        readFileSync(join(root, 'infra/cwv-runner', name))
      );
    writeFileSync(
      join(fixture, 'infra/cwv-runner', 'vps-ssh.sh'),
      '#!/bin/sh\nexit 64\n'
    );
    chmodSync(join(fixture, 'infra/cwv-runner', 'vps-ssh.sh'), 0o755);
    writeFileSync(join(fixture, 'infra/cwv-runner', 'a.mjs'), 'real\n');
    git(fixture, ['init', '-q']);
    git(fixture, ['add', '.']);
    git(fixture, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@invalid',
      'commit',
      '-qm',
      'base',
    ]);
    const reviewed = git(fixture, ['rev-parse', 'HEAD']);
    const object = git(fixture, ['rev-parse', 'HEAD:infra/cwv-runner/a.mjs']);
    const objectPath = join(
      fixture,
      '.git',
      'objects',
      object.slice(0, 2),
      object.slice(2)
    );
    chmodSync(objectPath, 0o600);
    writeFileSync(objectPath, deflateSync(Buffer.from('blob 10\0forged\n')));
    assert.throws(
      () =>
        freezeSourceManifest({
          baseSha: reviewed,
          cwd: fixture,
          mergeSha: reviewed,
          output: join(output, 'manifest.json'),
          outputDigest: join(output, 'manifest.sha256'),
          prNumber: 1,
          reviewedHeadSha: reviewed,
          sourceArchive: join(output, 'source.tar'),
          sourceArchiveDigest: join(output, 'source.tar.sha256'),
        }),
      /Git object hash mismatch|malformed Git object response/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});

test('allows unrelated merge changes outside the reviewed diff', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'cwv-merge-deletion-'));
  const output = mkdtempSync(join(tmpdir(), 'cwv-merge-deletion-output-'));
  try {
    mkdirSync(join(fixture, 'infra/cwv-runner'), { recursive: true });
    for (const name of [
      'policy.json',
      'canonical-json.mjs',
      'policy.schema.mjs',
      'source-archive.mjs',
      'source-manifest.mjs',
      'source-manifest-git.mjs',
      'source-manifest-objects.mjs',
      'source-manifest-tree.mjs',
    ])
      writeFileSync(
        join(fixture, 'infra/cwv-runner', name),
        readFileSync(join(root, 'infra/cwv-runner', name))
      );
    writeFileSync(
      join(fixture, 'infra/cwv-runner', 'vps-ssh.sh'),
      readFileSync(join(root, 'infra/cwv-runner', 'vps-ssh.sh'))
    );
    chmodSync(join(fixture, 'infra/cwv-runner', 'vps-ssh.sh'), 0o755);
    writeFileSync(join(fixture, 'README.md'), 'unchanged\n');
    git(fixture, ['init', '-q']);
    git(fixture, ['add', '.']);
    git(fixture, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@invalid',
      'commit',
      '-qm',
      'reviewed',
    ]);
    const reviewed = git(fixture, ['rev-parse', 'HEAD']);
    git(fixture, ['rm', 'README.md']);
    git(fixture, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@invalid',
      'commit',
      '-qm',
      'merge',
    ]);
    const merge = git(fixture, ['rev-parse', 'HEAD']);
    const manifest = freezeSourceManifest({
      baseSha: reviewed,
      cwd: fixture,
      mergeSha: merge,
      output: join(output, 'manifest.json'),
      outputDigest: join(output, 'manifest.sha256'),
      prNumber: 1,
      reviewedHeadSha: reviewed,
      sourceArchive: join(output, 'source.tar'),
      sourceArchiveDigest: join(output, 'source.tar.sha256'),
    });
    assert.equal(manifest.entries.length, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});
