import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import test from 'node:test';

import { fsyncTask9Directory } from './task9-fsync-directory.mjs';

test('opens the directory without following links, fsyncs, and closes it', () => {
  const calls = [];
  fsyncTask9Directory('/private/tmp/output', {
    close(fd) {
      calls.push(['close', fd]);
    },
    fsync(fd) {
      calls.push(['fsync', fd]);
    },
    open(path, flags) {
      calls.push(['open', path, flags]);
      return 17;
    },
  });
  assert.deepEqual(calls, [
    [
      'open',
      '/private/tmp/output',
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    ],
    ['fsync', 17],
    ['close', 17],
  ]);
});

test('closes the held directory descriptor when fsync fails', () => {
  let closed = false;
  assert.throws(
    () =>
      fsyncTask9Directory('/private/tmp/output', {
        close() {
          closed = true;
        },
        fsync() {
          throw new Error('fsync failed');
        },
        open() {
          return 19;
        },
      }),
    /fsync failed/
  );
  assert.equal(closed, true);
});
