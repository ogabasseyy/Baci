import assert from 'node:assert/strict';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { withTask9OutputDirectory } from './task9-output-directory.mjs';

test('does not remove an externally created directory when exclusive mkdir loses a race', () => {
  const parent = mkdtempSync(join(tmpdir(), 'task9-output-race-'));
  const output = join(parent, 'output');
  const marker = join(output, 'external');
  try {
    assert.throws(
      () =>
        withTask9OutputDirectory(output, () => undefined, {
          makeDirectory(path, options) {
            mkdirSync(path, options);
            writeFileSync(marker, 'external');
            const error = new Error('external mkdir won');
            error.code = 'EEXIST';
            throw error;
          },
        }),
      /external mkdir won/
    );
    assert.equal(readFileSync(marker, 'utf8'), 'external');
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test('preserves the exclusively created output after publication fails', () => {
  const parent = mkdtempSync(join(tmpdir(), 'task9-output-cleanup-'));
  const output = join(parent, 'output');
  try {
    assert.throws(
      () =>
        withTask9OutputDirectory(output, () => {
          throw new Error('publication failed');
        }),
      /publication failed/
    );
    assert.equal(lstatSync(output).isDirectory(), true);
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test('preserves a replacement installed after the owned directory is renamed', () => {
  const parent = mkdtempSync(join(tmpdir(), 'task9-output-replaced-'));
  const output = join(parent, 'output');
  const moved = join(parent, 'owned-moved');
  const marker = join(output, 'replacement');
  try {
    assert.throws(
      () =>
        withTask9OutputDirectory(output, () => {
          renameSync(output, moved);
          mkdirSync(output, { mode: 0o700 });
          writeFileSync(marker, 'replacement');
          throw new Error('publication failed after replacement');
        }),
      /publication failed after replacement/
    );
    assert.equal(readFileSync(marker, 'utf8'), 'replacement');
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test('refuses success when the published output path was replaced', () => {
  const parent = mkdtempSync(join(tmpdir(), 'task9-output-success-race-'));
  const output = join(parent, 'output');
  const moved = join(parent, 'owned-moved');
  const marker = join(output, 'replacement');
  try {
    assert.throws(
      () =>
        withTask9OutputDirectory(output, () => {
          renameSync(output, moved);
          mkdirSync(output, { mode: 0o700 });
          writeFileSync(marker, 'replacement');
          return 'published';
        }),
      /output directory changed/
    );
    assert.equal(readFileSync(marker, 'utf8'), 'replacement');
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test('refuses unsafe created directories before calling publish', () => {
  const parent = mkdtempSync(join(tmpdir(), 'task9-output-unsafe-'));
  let published = false;
  try {
    const output = join(parent, 'symlink');
    assert.throws(
      () =>
        withTask9OutputDirectory(
          output,
          () => {
            published = true;
          },
          {
            makeDirectory(path) {
              const target = join(parent, 'target');
              mkdirSync(target, { mode: 0o700 });
              symlinkSync(target, path);
            },
          }
        ),
      /ELOOP|ENOTDIR|unsafe Task 9 output directory/
    );
    assert.equal(published, false);
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test('applies the exact output mode despite a restrictive umask', () => {
  const parent = mkdtempSync(join(tmpdir(), 'task9-output-umask-'));
  const output = join(parent, 'output');
  const previousUmask = process.umask(0o177);
  try {
    withTask9OutputDirectory(output, () => {
      writeFileSync(join(output, 'bootstrap-review-envelope.json'), '{}');
      writeFileSync(
        join(output, 'bootstrap-review-envelope.sha256'),
        'digest\n'
      );
      mkdirSync(join(output, 'payload'));
    });
    const fd = openSync(
      output,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    try {
      assert.equal(fstatSync(fd).mode & 0o777, 0o700);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } finally {
    process.umask(previousUmask);
    rmSync(parent, { force: true, recursive: true });
  }
});

test('rechecks the output entry set after final validation', () => {
  const parent = mkdtempSync(join(tmpdir(), 'task9-output-final-entry-'));
  const output = join(parent, 'output');
  try {
    assert.throws(
      () =>
        withTask9OutputDirectory(
          output,
          () => {
            writeFileSync(join(output, 'bootstrap-review-envelope.json'), '{}');
            writeFileSync(
              join(output, 'bootstrap-review-envelope.sha256'),
              'digest\n'
            );
            mkdirSync(join(output, 'payload'));
          },
          {
            afterPublishValidation() {
              writeFileSync(join(output, 'unexpected'), 'race');
            },
          }
        ),
      /output entry set changed/
    );
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});
