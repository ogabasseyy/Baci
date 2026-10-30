import assert from 'node:assert/strict';
import { existsSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './worker-release.test-fixtures.mjs';

const linuxOnly = {
  skip: process.platform !== 'linux' && 'needs GNU coreutils and flock',
};

function release(host, sha) {
  const build = host.run('build', sha);
  assert.equal(build.status, 0, build.stderr);
  const activate = host.run('activate', sha);
  assert.equal(activate.status, 0, activate.stderr);
}

test(
  'builds and activates an exact main commit behind one current symlink',
  linuxOnly,
  () => {
    const host = createHost();
    release(host, host.firstSha);

    assert.equal(
      readlinkSync(join(host.root, 'current')),
      `releases/${host.firstSha}`
    );
    assert.equal(host.read('baci-workers/app-checkout.sha'), host.firstSha);
    assert.equal(
      realpathSync(
        join(host.root, 'baci-workers/bin/process-gigl-tracking.sh')
      ),
      realpathSync(
        join(
          host.root,
          'releases',
          host.firstSha,
          'workers/bin/process-gigl-tracking.sh'
        )
      )
    );
    assert.ok(existsSync(join(host.root, 'baci-workers/bin/gigl-dotenv.sh')));
    assert.equal(
      realpathSync(join(host.root, 'app-live')),
      realpathSync(join(host.root, 'releases', host.firstSha, 'app'))
    );
    assert.equal(host.run('status').stdout.trim(), host.firstSha);
  }
);

test(
  'installs the schedule for the worker directory without Docker remediation jobs',
  linuxOnly,
  () => {
    const host = createHost();
    release(host, host.firstSha);
    const crontab = host.read('installed-crontab');
    const workers = join(host.root, 'baci-workers');

    assert.match(crontab, /^# >>> baci-workers >>>$/m);
    assert.match(crontab, /^# <<< baci-workers <<<$/m);
    assert.ok(crontab.includes(`flock -n ${workers}/locks/gigl-tracking.lock`));
    assert.ok(
      crontab.includes(`${workers}/jobs/run-cache-invalidation-cron.mjs`)
    );
    assert.doesNotMatch(crontab, /vercel-error-remediator|\$[A-Z{]/);
    assert.equal(host.read('baci-workers/state/installed-crontab'), crontab);
    assert.match(host.read('services.log'), new RegExp(`events ${workers}`));
  }
);

test(
  'refuses a commit that is not reachable from origin main',
  linuxOnly,
  () => {
    const host = createHost();
    const result = host.run('build', host.sideCommit());

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /was not fetched from origin/);
  }
);

test(
  'refuses to activate a built commit that main no longer contains',
  linuxOnly,
  () => {
    const host = createHost();
    const dropped = host.commit('dropped');
    assert.equal(host.run('build', dropped).status, 0);
    host.resetMain(host.firstSha);

    const result = host.run('activate', dropped);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not on origin\/main/);
    assert.ok(!existsSync(join(host.root, 'current')));
  }
);

test(
  'rejects malformed commit identifiers before touching the host',
  linuxOnly,
  () => {
    const host = createHost();
    const result = host.run('build', 'main');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /40-character commit SHA/);
  }
);

test(
  'restores the previous release when the new release fails preflight',
  linuxOnly,
  () => {
    const host = createHost();
    release(host, host.firstSha);
    const next = host.commit('second');
    assert.equal(host.run('build', next).status, 0);
    writeFileSync(join(host.root, 'fail-preflight'), '');

    const result = host.run('activate', next);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /preflight failed/);
    assert.equal(host.run('status').stdout.trim(), host.firstSha);
    assert.equal(host.read('baci-workers/app-checkout.sha'), host.firstSha);
  }
);

test(
  'keeps persistent worker state across releases and rolls back on request',
  linuxOnly,
  () => {
    const host = createHost();
    release(host, host.firstSha);
    writeFileSync(
      join(host.root, 'baci-workers/logs/gigl-tracking.log'),
      'tick\n'
    );
    const next = host.commit('second');
    release(host, next);

    assert.equal(host.read('baci-workers/.env'), 'BACI_REPO_DIR=x\n');
    assert.equal(host.read('baci-workers/logs/gigl-tracking.log'), 'tick\n');
    assert.ok(existsSync(join(host.root, 'baci-workers/bin/extra.sh')));

    const rollback = host.run('rollback');
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.equal(host.run('status').stdout.trim(), host.firstSha);
    assert.ok(!existsSync(join(host.root, 'baci-workers/bin/extra.sh')));
    assert.equal(host.read('baci-workers/logs/gigl-tracking.log'), 'tick\n');
  }
);

test(
  'prunes releases older than the current and previous ones',
  linuxOnly,
  () => {
    const host = createHost();
    release(host, host.firstSha);
    const second = host.commit('second');
    release(host, second);
    const third = host.commit('third');
    release(host, third);

    assert.ok(!existsSync(join(host.root, 'releases', host.firstSha)));
    assert.ok(existsSync(join(host.root, 'releases', second)));
    assert.ok(existsSync(join(host.root, 'releases', third)));
    assert.equal(
      host.read('baci-workers/state/previous-release').trim(),
      second
    );
  }
);

describeActivationFailure();

function describeActivationFailure() {
  test(
    'bugfix: restores the previous release and schedule when installing the new one fails',
    linuxOnly,
    () => {
      const host = createHost();
      release(host, host.firstSha);
      const scheduleBefore = host.read('installed-crontab');
      const next = host.commit('second');
      assert.equal(host.run('build', next).status, 0);
      writeFileSync(join(host.root, 'fail-crontab'), '');

      const result = host.run('activate', next);

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /activation of [0-9a-f]{40} failed; restored/
      );
      assert.equal(host.run('status').stdout.trim(), host.firstSha);
      assert.equal(host.read('installed-crontab'), scheduleBefore);
    }
  );

  test(
    'bugfix: leaves no worker schedule or release live when a first activation fails',
    linuxOnly,
    () => {
      const host = createHost();
      assert.equal(host.run('build', host.firstSha).status, 0);
      writeFileSync(join(host.root, 'fail-crontab'), '');

      const result = host.run('activate', host.firstSha);

      assert.notEqual(result.status, 0);
      assert.ok(!existsSync(join(host.root, 'current')));
      assert.ok(!existsSync(join(host.root, 'installed-crontab')));
      assert.match(host.read('systemctl.log'), /disable --now/);
    }
  );
}
