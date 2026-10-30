import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './worker-release.test-fixtures.mjs';

const linuxOnly = {
  skip: process.platform !== 'linux' && 'needs GNU coreutils and flock',
};

function release(host, sha) {
  for (const step of ['build', 'activate']) {
    const result = host.run(step, sha);
    assert.equal(result.status, 0, result.stderr);
  }
}

test(
  'bugfix: reactivating the live release keeps the rollback target',
  linuxOnly,
  () => {
    const host = createHost();
    release(host, host.firstSha);
    const next = host.commit('second');
    release(host, next);

    release(host, next);

    assert.ok(existsSync(join(host.root, 'releases', host.firstSha)));
    const rollback = host.run('rollback');
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.equal(host.run('status').stdout.trim(), host.firstSha);
  }
);

test('bugfix: accepts tsx hoisted to the workspace root', linuxOnly, () => {
  const host = createHost();
  writeFileSync(join(host.root, 'hoisted-tsx'), '');

  release(host, host.firstSha);

  assert.equal(host.run('status').stdout.trim(), host.firstSha);
});
