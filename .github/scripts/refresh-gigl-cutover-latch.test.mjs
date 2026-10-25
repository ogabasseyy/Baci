import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fixture } from './refresh-gigl-cutover-latch.test-fixtures.mjs';

const fixtures = [];
function setup(scope) {
  const value = fixture(scope);
  fixtures.push(value);
  return value;
}
afterEach(() => {
  for (const value of fixtures.splice(0))
    rmSync(value.root, { recursive: true, force: true });
});
function preserved(value, result) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(value.readLatch(), value.oldLatch);
  assert.equal(
    readdirSync(value.remote).filter((name) =>
      name.startsWith('.gigl-capability-smoke-ok.')
    ).length,
    0
  );
}
describe('guarded GIGL cutover latch refresh', () => {
  for (const scope of ['enabled', 'disabled']) {
    it(
      'refreshes ' +
        scope +
        ' identity only after a locked smoke using installed dotenv',
      () => {
        const value = setup(scope);
        const previousInode = statSync(value.latch).ino;
        const result = value.run();
        assert.equal(result.status, 0, result.stderr);
        assert.notEqual(statSync(value.latch).ino, previousInode);
        assert.equal(
          value.readLatch(),
          `${scope}:${value.sha}:${value.fingerprint}\n`
        );
        assert.equal(statSync(value.latch).mode & 0o777, 0o600);
        assert.deepEqual(JSON.parse(readFileSync(value.smokeRecord, 'utf8')), {
          locks: [true, true],
          token: value.token,
          scope: scope === 'disabled' ? 'false' : 'true',
          oldLatch: value.oldLatch,
          profile: 'gigl-tracking',
        });
        assert.doesNotMatch(
          result.stdout + result.stderr,
          /fixture-installed-token|fixture-caller-token/
        );
        assert.ok(!(result.stdout + result.stderr).includes(value.fingerprint));
      }
    );
  }
  for (const invalid of ['', 'A'.repeat(40), 'a'.repeat(39)]) {
    it(
      'rejects missing or malformed required SHA (' +
        invalid.length +
        ' characters)',
      () => {
        const value = setup();
        preserved(
          value,
          value.run({ BACI_EXPECTED_APP_SHA: invalid, GITHUB_SHA: value.sha })
        );
        assert.equal(existsSync(value.smokeRecord), false);
      }
    );
  }
  for (const change of ['sha', 'checkout', 'cron', 'preflight']) {
    it(`rejects initial ${change} drift before smoke`, () => {
      const value = setup();
      if (change === 'sha')
        writeFileSync(join(value.remote, 'app-checkout.sha'), 'c'.repeat(40));
      if (change === 'checkout')
        appendFileSync(join(value.checkout, 'worker.txt'), 'drift');
      if (change === 'cron') writeFileSync(value.cron, '');
      if (change === 'preflight')
        writeFileSync(value.state, JSON.stringify({ preflightFailed: true }));
      preserved(value, value.run());
      assert.equal(existsSync(value.smokeRecord), false);
    });
  }
  for (const exit of [1, 42]) {
    it(`preserves the previous latch when smoke exits ${exit}`, () => {
      const value = setup();
      writeFileSync(value.state, JSON.stringify({ exit }));
      const result = value.run();
      preserved(value, result);
      assert.equal(result.status, exit);
      assert.equal(existsSync(value.smokeRecord), true);
      assert.ok(!(result.stdout + result.stderr).includes(value.fingerprint));
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /fixture-installed-token/
      );
    });
  }
  for (const action of ['identity', 'sha', 'checkout', 'cron', 'preflight']) {
    it(`preserves the previous latch when ${action} changes during smoke`, () => {
      const value = setup();
      writeFileSync(value.state, JSON.stringify({ action }));
      preserved(value, value.run());
      assert.equal(existsSync(value.smokeRecord), true);
    });
  }
  it('keeps the old latch and removes its temporary file if atomic publication fails', () => {
    const value = setup();
    const fakeMv = join(value.root, 'test-bin/mv');
    writeFileSync(fakeMv, '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
    preserved(value, value.run());
    assert.equal(existsSync(value.smokeRecord), true);
  });
  for (const name of ['deployLock', 'trackingLock']) {
    it(`fails within the bounded wait while ${name} is held`, async () => {
      const value = setup();
      const holder = spawn(
        'python3',
        [
          '-u',
          '-c',
          'import fcntl,sys,time\nf=open(sys.argv[1], "a")\nfcntl.flock(f, fcntl.LOCK_EX)\nprint("locked", flush=True)\ntime.sleep(30)',
          value[name],
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      try {
        await once(holder.stdout, 'data');
        const result = value.run();
        preserved(value, result);
        assert.equal(existsSync(value.smokeRecord), false);
        assert.match(result.stderr, /lock/i);
      } finally {
        const closed = once(holder, 'close');
        holder.kill('SIGTERM');
        await closed;
      }
    });
  }
});
