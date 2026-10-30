import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRunner,
  LEGACY_CRONTAB,
  linuxOnly,
  SHA,
} from './release-host.test-fixtures.mjs';

test(
  'builds, retires the legacy schedule, activates and confirms the exact SHA',
  linuxOnly,
  () => {
    const runner = createRunner();
    const result = runner.run();

    assert.equal(result.status, 0, result.stderr);
    const log = runner.read('release.log');
    assert.match(log, new RegExp(`^build ${SHA} user=baci-worker`, 'm'));
    assert.match(log, new RegExp(`^activate ${SHA}`, 'm'));
    assert.doesNotMatch(log, /runner-secret/);
    assert.equal(
      runner.read('crontab'),
      '0 2 * * * /home/deploy/scripts/unrelated.sh\n'
    );
    assert.match(
      runner.read('systemctl.log'),
      /stop .*baci-quiz-finalization\.service/
    );
  }
);

test('restores the legacy schedule when activation fails', linuxOnly, () => {
  const runner = createRunner({ activateFails: true });
  const result = runner.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /restored the legacy worker schedule/);
  assert.equal(runner.read('crontab'), LEGACY_CRONTAB);
  assert.match(runner.read('systemctl.log'), /enable --now/);
});

test(
  'fails closed before any change on an unprovisioned host',
  linuxOnly,
  () => {
    const runner = createRunner({ provisioned: false });
    const result = runner.run();

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /provision-host\.sh/);
    assert.equal(runner.read('crontab'), LEGACY_CRONTAB);
  }
);

test('rejects anything but an exact commit SHA', linuxOnly, () => {
  const result = createRunner().run('main');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /40-character commit SHA/);
});

test(
  'bugfix: activates nothing while a legacy service is still running',
  linuxOnly,
  () => {
    const runner = createRunner({ legacyStuck: true });
    const result = runner.run();

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /did not stop cleanly/);
    assert.equal(runner.read('crontab'), LEGACY_CRONTAB);
    assert.doesNotMatch(runner.read('release.log'), /^activate/m);
  }
);

test(
  'bugfix: activates nothing when the legacy schedule cannot be removed',
  linuxOnly,
  () => {
    const runner = createRunner({ crontabWriteFails: true });
    const result = runner.run();

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /did not stop cleanly/);
    assert.doesNotMatch(runner.read('release.log'), /^activate/m);
  }
);
