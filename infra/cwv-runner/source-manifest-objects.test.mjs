import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyGitObjects } from './source-manifest-objects.mjs';

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'source-manifest-objects-'));
  execFileSync('/usr/bin/git', ['init', '-q', root]);
  writeFileSync(join(root, 'file.txt'), 'source\n');
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
    'source',
  ]);
  return root;
}

test('verifies a commit and its SHA-1 blob bytes', () => {
  const root = repository();
  try {
    const commit = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' }
    ).trim();
    const blob = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'rev-parse', 'HEAD:file.txt'],
      { encoding: 'utf8' }
    ).trim();
    const result = verifyGitObjects(root, [commit, blob]);
    assert.equal(result.get(`${root}\0${commit}`).type, 'commit');
    assert.equal(result.get(`${root}\0${blob}`).bytes.toString(), 'source\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed object IDs and subprocess responses', () => {
  const root = repository();
  try {
    assert.throws(
      () => verifyGitObjects(root, ['not-an-object']),
      /malformed Git object response/
    );
    assert.throws(
      () => verifyGitObjects(root, [`${'a'.repeat(39)}\n`]),
      /malformed Git object response/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifies a SHA-256 repository commit and blob', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-manifest-objects-sha256-'));
  try {
    execFileSync('/usr/bin/git', [
      'init',
      '--object-format=sha256',
      '-q',
      root,
    ]);
    writeFileSync(join(root, 'file.txt'), 'sha256\n');
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
      'source',
    ]);
    const commit = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' }
    ).trim();
    const blob = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'rev-parse', 'HEAD:file.txt'],
      { encoding: 'utf8' }
    ).trim();
    const result = verifyGitObjects(root, [commit, blob]);
    assert.equal(result.get(`${root}\0${commit}`).type, 'commit');
    assert.equal(result.get(`${root}\0${blob}`).bytes.toString(), 'sha256\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
