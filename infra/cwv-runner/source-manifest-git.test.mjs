// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: the hostile Git environment regression intentionally mutates GIT_DIR.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { git } from './source-manifest-git.mjs';
import { withHeldTask9Checkout } from './task9-held-checkout.mjs';

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'source-manifest-git-'));
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

test('runs the fixed Git executable with the requested arguments', () => {
  const root = repository();
  try {
    assert.match(
      git(root, ['rev-parse', '--show-toplevel']).trim(),
      /source-manifest-git-/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps Git traversal bound to the held checkout on every platform', () => {
  const root = repository();
  try {
    const result = withHeldTask9Checkout(root, realpathSync(root), (checkout) =>
      git(checkout, ['rev-parse', '--show-toplevel'])
    );
    assert.match(result.trim(), /source-manifest-git-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects subprocess failures instead of returning alternate output', () => {
  const root = repository();
  try {
    assert.throws(() => git(root, ['definitely-invalid']), /Command failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not pass hostile Git environment variables to the subprocess', () => {
  const root = repository();
  const previous = process.env.GIT_DIR;
  try {
    process.env.GIT_DIR = join(root, 'missing-object-database');
    assert.match(
      git(root, ['rev-parse', '--show-toplevel']).trim(),
      /source-manifest-git-/
    );
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
