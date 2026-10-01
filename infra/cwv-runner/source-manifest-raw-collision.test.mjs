import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

import { freezeSourceManifest } from './source-manifest.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const git = (cwd, args) =>
  execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' }).trim();

test('rejects a changed raw Git name that collides with a literal surrogate', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'source-manifest-raw-collision-'));
  const output = mkdtempSync(join(tmpdir(), 'source-manifest-raw-output-'));
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
        readFileSync(join(repositoryRoot, 'infra/cwv-runner', name))
      );
    writeFileSync(
      join(fixture, 'infra/cwv-runner/vps-ssh.sh'),
      readFileSync(join(repositoryRoot, 'infra/cwv-runner/vps-ssh.sh'))
    );
    chmodSync(join(fixture, 'infra/cwv-runner/vps-ssh.sh'), 0o755);
    git(fixture, ['init', '-q']);
    git(fixture, ['add', '-A']);
    git(fixture, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@invalid',
      'commit',
      '-qm',
      'base',
    ]);
    const infra = git(fixture, ['rev-parse', 'HEAD:infra']);
    const object = (bytes) =>
      execFileSync('/usr/bin/git', ['hash-object', '-w', '--stdin'], {
        cwd: fixture,
        input: bytes,
      })
        .toString()
        .trim();
    const tree = (rawObject) =>
      execFileSync('/usr/bin/git', ['mktree', '-z'], {
        cwd: fixture,
        input: Buffer.concat([
          Buffer.from(`100644 blob ${rawObject}\tbad`),
          Buffer.from([0xff, 0]),
          Buffer.from(`040000 tree ${infra}\tinfra\0`),
          Buffer.from(
            `100644 blob ${object(Buffer.from('literal\n'))}\t~gitraw-626164ff\0`
          ),
        ]),
      })
        .toString()
        .trim();
    const commit = (treeId, parent = []) =>
      execFileSync(
        '/usr/bin/git',
        [
          '-c',
          'user.name=test',
          '-c',
          'user.email=test@invalid',
          'commit-tree',
          treeId,
          ...parent.flatMap((sha) => ['-p', sha]),
        ],
        { cwd: fixture, input: 'commit\n' }
      )
        .toString()
        .trim();
    const base = commit(tree(object(Buffer.from('base\n'))));
    const reviewed = commit(tree(object(Buffer.from('reviewed\n'))), [base]);

    assert.throws(
      () =>
        freezeSourceManifest({
          baseSha: base,
          cwd: fixture,
          mergeSha: reviewed,
          output: join(output, 'manifest.json'),
          outputDigest: join(output, 'manifest.sha256'),
          prNumber: 1,
          reviewedHeadSha: reviewed,
          sourceArchive: join(output, 'source.tar'),
          sourceArchiveDigest: join(output, 'source.tar.sha256'),
        }),
      /non-UTF-8 source path/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});
