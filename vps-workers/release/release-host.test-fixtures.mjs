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
import { fileURLToPath } from 'node:url';

export const releaseDir = dirname(fileURLToPath(import.meta.url));
export const linuxOnly = {
  skip: process.platform !== 'linux' && 'needs GNU coreutils and flock',
};
export const SHA = 'a'.repeat(40);
export const LEGACY_CRONTAB = [
  '0 2 * * * /home/deploy/scripts/unrelated.sh',
  '# >>> baci-workers >>>',
  '*/5 * * * * legacy gigl',
  '# <<< baci-workers <<<',
  '',
].join('\n');

export function executable(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

// The deploy runner host: `sudo` and `id` are stubs, and the release script
// beside sync-from-runner.sh records its commands instead of building.
export function createRunner({
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

export function migrate(envFile) {
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
