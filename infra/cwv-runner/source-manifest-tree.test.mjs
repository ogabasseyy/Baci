import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import { authenticatedTreeRows } from './source-manifest-tree.mjs';

test('walks authenticated nested tree bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-manifest-tree-'));
  try {
    execFileSync('/usr/bin/git', ['init', '-q', root]);
    execFileSync('/usr/bin/git', ['-C', root, 'config', 'user.name', 'test']);
    execFileSync('/usr/bin/git', [
      '-C',
      root,
      'config',
      'user.email',
      'test@invalid',
    ]);
    mkdirSync(join(root, 'nested'), { recursive: true });
    writeFileSync(join(root, 'nested/file.txt'), 'tree\n');
    execFileSync('/usr/bin/git', ['-C', root, 'add', '.']);
    execFileSync('/usr/bin/git', ['-C', root, 'commit', '-qm', 'tree']);
    const sha = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' }
    ).trim();
    assert.deepEqual(
      authenticatedTreeRows(root, sha).map(({ mode, path }) => ({
        mode,
        path,
      })),
      [{ mode: '100644', path: 'nested/file.txt' }]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('can authenticate tree rows without hashing unchanged blob bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-manifest-tree-blob-check-'));
  try {
    execFileSync('/usr/bin/git', ['init', '-q', root]);
    writeFileSync(join(root, 'file.txt'), 'tree\n');
    execFileSync('/usr/bin/git', ['-C', root, 'add', '.']);
    execFileSync('/usr/bin/git', [
      '-C',
      root,
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@invalid',
      'commit',
      '-qm',
      'tree',
    ]);
    const sha = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'rev-parse', 'HEAD'],
      {
        encoding: 'utf8',
      }
    ).trim();
    const blob = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'rev-parse', 'HEAD:file.txt'],
      { encoding: 'utf8' }
    ).trim();
    const objectPath = join(
      root,
      '.git',
      'objects',
      blob.slice(0, 2),
      blob.slice(2)
    );
    chmodSync(objectPath, 0o600);
    writeFileSync(objectPath, deflateSync(Buffer.from('blob 5\0fake\n')));
    assert.deepEqual(
      authenticatedTreeRows(root, sha, { verifyBlobs: false }).map(
        ({ path }) => path
      ),
      ['file.txt']
    );
    assert.throws(
      () => authenticatedTreeRows(root, sha),
      /Git object hash mismatch/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects non-commit and malformed-commit objects while authenticating symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-manifest-tree-invalid-'));
  try {
    execFileSync('/usr/bin/git', ['init', '-q', root]);
    execFileSync('/usr/bin/git', ['-C', root, 'config', 'user.name', 'test']);
    execFileSync('/usr/bin/git', [
      '-C',
      root,
      'config',
      'user.email',
      'test@invalid',
    ]);
    const blob = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'hash-object', '-w', '--stdin'],
      { input: 'blob\n', encoding: 'utf8' }
    ).trim();
    assert.throws(
      () => authenticatedTreeRows(root, blob),
      /source SHA must name a commit/
    );
    const malformed = execFileSync(
      '/usr/bin/git',
      [
        '-C',
        root,
        'hash-object',
        '--literally',
        '-t',
        'commit',
        '-w',
        '--stdin',
      ],
      {
        input: 'author test <test@invalid> 0 +0000\n\nmessage\n',
        encoding: 'utf8',
      }
    ).trim();
    assert.throws(
      () => authenticatedTreeRows(root, malformed),
      /malformed Git commit object/
    );
    const oddTreeSha = execFileSync(
      '/usr/bin/git',
      [
        '-C',
        root,
        'hash-object',
        '--literally',
        '-t',
        'commit',
        '-w',
        '--stdin',
      ],
      {
        input: `tree ${'a'.repeat(41)}\nauthor test <test@invalid> 0 +0000\ncommitter test <test@invalid> 0 +0000\n\nodd\n`,
        encoding: 'utf8',
      }
    ).trim();
    assert.throws(
      () => authenticatedTreeRows(root, oddTreeSha),
      /malformed Git commit object/
    );
    execFileSync('/usr/bin/git', [
      '-C',
      root,
      'update-index',
      '--add',
      '--cacheinfo',
      `120000,${blob},link`,
    ]);
    const tree = execFileSync('/usr/bin/git', ['-C', root, 'write-tree'], {
      encoding: 'utf8',
    }).trim();
    const commit = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'commit-tree', tree],
      { input: 'tree\n', encoding: 'utf8' }
    ).trim();
    assert.deepEqual(
      authenticatedTreeRows(root, commit).map(({ mode, path }) => ({
        mode,
        path,
      })),
      [{ mode: '120000', path: 'link' }]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves an unchanged gitlink whose commit is absent locally', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-manifest-tree-gitlink-'));
  try {
    execFileSync('/usr/bin/git', ['init', '-q', root]);
    execFileSync('/usr/bin/git', ['-C', root, 'config', 'user.name', 'test']);
    execFileSync('/usr/bin/git', [
      '-C',
      root,
      'config',
      'user.email',
      'test@invalid',
    ]);
    const missing = 'a'.repeat(40);
    execFileSync('/usr/bin/git', [
      '-C',
      root,
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${missing},vendor`,
    ]);
    const tree = execFileSync('/usr/bin/git', ['-C', root, 'write-tree'], {
      encoding: 'utf8',
    }).trim();
    const commit = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'commit-tree', tree],
      { input: 'gitlink\n', encoding: 'utf8' }
    ).trim();
    assert.deepEqual(authenticatedTreeRows(root, commit), [
      {
        gitlink: true,
        mode: '160000',
        objectId: missing,
        path: 'vendor',
        rawPath: false,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves non-UTF-8 Git tree names outside the source projection', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-manifest-tree-utf8-'));
  try {
    execFileSync('/usr/bin/git', ['init', '-q', root]);
    const blob = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'hash-object', '-w', '--stdin'],
      { input: Buffer.from('blob\n') }
    )
      .toString()
      .trim();
    const treeBytes = Buffer.concat([
      Buffer.from('100644 invalid'),
      Buffer.from([0xff, 0]),
      Buffer.from(blob, 'hex'),
    ]);
    const tree = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'hash-object', '--literally', '-t', 'tree', '-w', '--stdin'],
      { input: treeBytes }
    )
      .toString()
      .trim();
    const commit = execFileSync(
      '/usr/bin/git',
      [
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@invalid',
        '-C',
        root,
        'commit-tree',
        tree,
      ],
      {
        input:
          'author test <test@invalid> 0 +0000\ncommitter test <test@invalid> 0 +0000\n\ninvalid\n',
      }
    )
      .toString()
      .trim();
    assert.deepEqual(authenticatedTreeRows(root, commit), [
      {
        mode: '100644',
        objectId: blob,
        path: '~gitraw-696e76616c6964ff',
        rawPath: true,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
