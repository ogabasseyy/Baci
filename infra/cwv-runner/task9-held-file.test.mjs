import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readHeldTask9File } from './task9-held-file.mjs';

test('refuses a pathname swapped after reading its held descriptor', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-held-file-'));
  const path = join(root, 'source');
  const moved = join(root, 'source.moved');
  try {
    chmodSync(root, 0o700);
    writeFileSync(path, 'reviewed', { mode: 0o600 });
    assert.throws(
      () =>
        readHeldTask9File(path, 0o600, {
          afterRead() {
            renameSync(path, moved);
            writeFileSync(path, 'replacement', { mode: 0o600 });
          },
        }),
      /unsafe Task 9 input/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('returns bytes only when the descriptor and path identity remain exact', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-held-file-pass-'));
  const path = join(root, 'source');
  try {
    chmodSync(root, 0o700);
    writeFileSync(path, 'reviewed', { mode: 0o600 });
    assert.deepEqual(
      readHeldTask9File(path, 0o600).bytes,
      Buffer.from('reviewed')
    );
    assert.equal(lstatSync(path).isFile(), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('refuses symlinks and wrong modes before reading bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-held-file-mode-'));
  const path = join(root, 'source');
  const link = join(root, 'source-link');
  try {
    chmodSync(root, 0o700);
    writeFileSync(path, 'reviewed', { mode: 0o600 });
    symlinkSync(path, link);
    assert.throws(() => readHeldTask9File(link, 0o600), /unsafe Task 9 input/);
    chmodSync(path, 0o400);
    assert.throws(() => readHeldTask9File(path, 0o600), /unsafe Task 9 input/);
    assert.equal(readFileSync(path, 'utf8'), 'reviewed');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('refuses an oversized input before allocating its contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-held-file-size-'));
  const path = join(root, 'source');
  try {
    chmodSync(root, 0o700);
    writeFileSync(path, '', { mode: 0o600 });
    truncateSync(path, 17);
    assert.throws(
      () => readHeldTask9File(path, 0o600, { maxBytes: 16 }),
      /unsafe Task 9 input/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('refuses a FIFO without blocking on a writer', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-held-file-fifo-'));
  const path = join(root, 'source');
  try {
    chmodSync(root, 0o700);
    execFileSync('/usr/bin/mkfifo', ['-m', '600', path]);
    assert.throws(() => readHeldTask9File(path, 0o600), /unsafe Task 9 input/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('preserves the underlying descriptor error as the refusal cause', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-held-file-cause-'));
  try {
    assert.throws(
      () => readHeldTask9File(join(root, 'missing'), 0o600),
      (error) =>
        error instanceof TypeError &&
        error.message === 'unsafe Task 9 input' &&
        error.cause instanceof Error
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
