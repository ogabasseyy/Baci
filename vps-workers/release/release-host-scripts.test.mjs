import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const releaseDir = dirname(fileURLToPath(import.meta.url));
const linuxOnly = {
  skip: process.platform !== 'linux' && 'needs GNU coreutils and flock',
};
const SHA = 'a'.repeat(40);
const LEGACY_CRONTAB = [
  '0 2 * * * /home/deploy/scripts/unrelated.sh',
  '# >>> baci-workers >>>',
  '*/5 * * * * legacy gigl',
  '# <<< baci-workers <<<',
  '',
].join('\n');

function executable(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

// The deploy runner host: `sudo` and `id` are stubs, and the release script
// beside sync-from-runner.sh records its commands instead of building.
function createRunner({
  activateFails = false,
  provisioned = true,
  legacyStuck = false,
  crontabWriteFails = false,
} = {}) {
  const base = mkdtempSync(join(tmpdir(), 'baci-sync-runner-'));
  const scripts = join(base, 'scripts');
  const stubs = join(base, 'stubs');
  const root = join(base, 'root');
  mkdirSync(join(root, 'baci-workers'), { recursive: true });
  mkdirSync(join(base, 'run-user'));
  mkdirSync(scripts);
  if (provisioned) writeFileSync(join(root, 'baci-workers/.env'), 'X=1\n');
  copyFileSync(
    join(releaseDir, 'sync-from-runner.sh'),
    join(scripts, 'sync-from-runner.sh')
  );
  executable(
    join(scripts, 'worker-release.sh'),
    `echo "$* user=$USER path=$PATH token=\${GITHUB_TOKEN:-none}" >> "${base}/release.log"
case "$1" in
  activate) ${activateFails ? 'exit 1' : 'echo "$2" > "$BACI_WORKER_ROOT/active"'} ;;
  status) cat "$BACI_WORKER_ROOT/active" ;;
esac
`
  );
  executable(
    join(stubs, 'id'),
    `case "$*" in -un) echo deploy ;; '-u baci-worker') ${provisioned ? 'echo 999' : 'exit 1'} ;; *) exit 1 ;; esac\n`
  );
  executable(
    join(stubs, 'sudo'),
    'while [ "$#" -gt 0 ] && [ "$1" != -- ]; do case "$1" in -u) shift 2 ;; -*) shift ;; *) break ;; esac; done; [ "$1" != -- ] || shift; exec "$@"\n'
  );
  executable(
    join(stubs, 'crontab'),
    `case "$1" in -l) cat "${base}/crontab" ;; -) ${crontabWriteFails ? 'cat >/dev/null; exit 1' : `cat > "${base}/crontab"`} ;; *) cp "$1" "${base}/crontab" ;; esac\n`
  );
  executable(
    join(stubs, 'systemctl'),
    `echo "$*" >> "${base}/systemctl.log"
case "$*" in *is-active*) ${legacyStuck ? 'exit 0' : 'exit 3'} ;; esac
`
  );
  writeFileSync(join(base, 'crontab'), LEGACY_CRONTAB);
  const env = {
    HOME: base,
    PATH: `${stubs}:/usr/bin:/bin`,
    GITHUB_TOKEN: 'runner-secret',
    BACI_WORKER_ROOT: root,
    BACI_WORKER_RUNTIME_DIR: join(base, 'run-user'),
    BACI_LEGACY_WORKER_DIR: join(base, 'legacy'),
    BACI_WORKER_LOCK_WAIT_SECONDS: '1',
  };
  const run = (sha = SHA) =>
    spawnSync('bash', [join(scripts, 'sync-from-runner.sh'), sha], {
      env,
      encoding: 'utf8',
    });
  const read = (name) => readFileSync(join(base, name), 'utf8');
  return { run, read };
}

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

function migrate(envFile) {
  return spawnSync(
    'bash',
    [
      '-c',
      `source "${join(releaseDir, 'provision-host.sh')}" && migrate_env "$1"`,
      'x',
      envFile,
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: '/usr/bin:/bin',
        BACI_DEPLOY_USER: 'deploy',
        BACI_WORKER_ROOT: '/srv/w',
      },
    }
  );
}

test(
  'migrates the worker environment without deployment credentials',
  linuxOnly,
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'baci-provision-'));
    const envFile = join(dir, '.env');
    writeFileSync(
      envFile,
      [
        '# comment',
        'GIGL_TRACKING_WORKER_TOKEN=keep-me',
        'export GITHUB_PERSONAL_ACCESS_TOKEN=drop-1',
        'SUPABASE_ACCESS_TOKEN=drop-2',
        'VERCEL_OIDC_TOKEN=drop-3',
        'BACI_REMEDIATION_OUTPUT_DIR=/home/deploy/x',
        'BACI_REPO_DIR=/home/deploy/app-live',
        'VERCEL_ERROR_LOG_PATH=/home/deploy/baci-workers/logs/vercel-drain.jsonl',
        '',
      ].join('\n')
    );

    const result = migrate(envFile);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      [
        '# comment',
        'GIGL_TRACKING_WORKER_TOKEN=keep-me',
        'BACI_REPO_DIR=/srv/w/app-live',
        'VERCEL_ERROR_LOG_PATH=/srv/w/baci-workers/logs/vercel-drain.jsonl',
        '',
      ].join('\n')
    );
  }
);

test(
  'refuses to migrate a kept setting that still points into the deploy home',
  linuxOnly,
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'baci-provision-'));
    const envFile = join(dir, '.env');
    writeFileSync(
      envFile,
      'SECRET_VALUE=abc\nSOME_PATH=/home/deploy/elsewhere\n'
    );

    const result = migrate(envFile);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SOME_PATH still points into \/home\/deploy/);
    assert.doesNotMatch(result.stderr + result.stdout, /abc/);
  }
);

test(
  'run-as-worker passes only allowlisted settings into installed scripts',
  linuxOnly,
  () => {
    const base = mkdtempSync(join(tmpdir(), 'baci-run-as-worker-'));
    const stubs = join(base, 'stubs');
    const root = join(base, 'root');
    executable(
      join(stubs, 'sudo'),
      'while [ "$#" -gt 0 ] && [ "$1" != -- ]; do case "$1" in -u) shift 2 ;; -*) shift ;; *) break ;; esac; done; [ "$1" != -- ] || shift; exec "$@"\n'
    );
    executable(join(stubs, 'id'), 'echo 999\n');
    executable(
      join(root, 'app-live/vps-workers/bin/check.sh'),
      'env | sort; echo "args=$*"\n'
    );
    const env = {
      PATH: `${stubs}:/usr/bin:/bin`,
      BACI_WORKER_ROOT: root,
      BACI_EXPECTED_APP_SHA: SHA,
      GITHUB_TOKEN: 'runner-secret',
    };
    const run = (script) =>
      spawnSync(
        'bash',
        [join(releaseDir, 'run-as-worker.sh'), script, '--flag'],
        { env, encoding: 'utf8' }
      );

    const result = run('vps-workers/bin/check.sh');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`BACI_EXPECTED_APP_SHA=${SHA}`));
    assert.match(
      result.stdout,
      new RegExp(`VPS_WORKER_REMOTE_DIR=${root}/baci-workers`)
    );
    assert.match(result.stdout, /args=--flag/);
    assert.doesNotMatch(result.stdout, /runner-secret/);

    assert.notEqual(run('../outside.sh').status, 0);
    assert.notEqual(run('/etc/passwd.sh').status, 0);
  }
);

test(
  'bugfix: drops credentials written with dotenv spacing or colon syntax',
  linuxOnly,
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'baci-provision-'));
    const envFile = join(dir, '.env');
    writeFileSync(
      envFile,
      'GITHUB_TOKEN = drop-1\nexport SUPABASE_ACCESS_TOKEN: drop-2\nKEEP = yes\n'
    );

    const result = migrate(envFile);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'KEEP = yes\n');
    const check = spawnSync(
      'bash',
      [
        '-c',
        `source "${join(releaseDir, 'provision-host.sh')}" && has_dropped_key "$1"`,
        'x',
        envFile,
      ],
      { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }
    );
    assert.equal(
      check.status,
      0,
      'the readiness check must detect spaced credentials'
    );
  }
);

test(
  'bugfix: maps a nested legacy app-live checkout to the release symlink',
  linuxOnly,
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'baci-provision-'));
    const envFile = join(dir, '.env');
    writeFileSync(
      envFile,
      'BACI_REPO_DIR=/home/deploy/baci-workers/app-live\n'
    );

    const result = migrate(envFile);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'BACI_REPO_DIR=/srv/w/app-live\n');
  }
);

test(
  'run-as-worker refuses a configured worker directory outside the release root',
  linuxOnly,
  () => {
    const base = mkdtempSync(join(tmpdir(), 'baci-run-as-worker-'));
    const stubs = join(base, 'stubs');
    const root = join(base, 'root');
    executable(join(stubs, 'sudo'), 'exit 99\n');
    executable(join(stubs, 'id'), 'echo 999\n');
    executable(join(root, 'app-live/vps-workers/bin/check.sh'), 'true\n');

    const result = spawnSync(
      'bash',
      [join(releaseDir, 'run-as-worker.sh'), 'vps-workers/bin/check.sh'],
      {
        encoding: 'utf8',
        env: {
          PATH: `${stubs}:/usr/bin:/bin`,
          BACI_WORKER_ROOT: root,
          VPS_WORKER_REMOTE_DIR: '/home/deploy/baci-workers',
        },
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VPS_WORKER_REMOTE_DIR must be/);
  }
);

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
