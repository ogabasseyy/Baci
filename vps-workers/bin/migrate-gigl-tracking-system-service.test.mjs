import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const original = readFileSync(new URL('./migrate-gigl-tracking-system-service.sh', import.meta.url), 'utf8');

function fixture(t, {
  crontab,
  failSystemctl = '',
  workerRootOwnerMode = 'root:baci-locks:710',
  releasesOwnerMode = '0:990:750',
  activeReleaseOwnerMode = '0:990:550',
} = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gigl-service-migration-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workerRoot = join(root, 'worker');
  const legacyRoot = join(root, 'legacy');
  const legacyLock = join(legacyRoot, 'locks', 'gigl-tracking.lock');
  crontab = typeof crontab === 'function'
    ? crontab(root, legacyLock)
    : crontab ?? `SHELL=/bin/bash\n*/5 * * * * flock -n ${legacyLock} bash -lc 'cd ${legacyRoot} && timeout 2m ${legacyRoot}/bin/process-gigl-tracking.sh'\n15 * * * * ${legacyRoot}/bin/other-job.sh\n`;
  const unitDir = join(root, 'systemd');
  const backupRoot = join(root, 'backup-store', 'gigl-tracking-migration-backups');
  const releaseSha = 'a'.repeat(40);
  const releasePath = join(workerRoot, 'releases', releaseSha);
  const bin = join(root, 'mock-bin');
  const state = join(root, 'state');
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(join(releasePath, 'bin'), { recursive: true });
  symlinkSync(join('releases', releaseSha), join(workerRoot, 'current'));
  mkdirSync(join(workerRoot, 'runtime'), { recursive: true });
  for (const name of ['locks', 'logs', 'home']) mkdirSync(join(workerRoot, name), { recursive: true });
  mkdirSync(join(legacyRoot, 'locks'), { recursive: true });
  writeFileSync(legacyLock, '');
  writeFileSync(join(workerRoot, 'locks', 'gigl-tracking.lock'), '');
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(join(releasePath, 'bin', 'process-gigl-tracking.sh'), '#!/bin/sh\n');
  writeFileSync(join(releasePath, 'bin', 'verify-gigl-tracking-worker-capability.sh'), '#!/bin/sh\n');
  chmodSync(join(releasePath, 'bin', 'process-gigl-tracking.sh'), 0o555);
  chmodSync(join(releasePath, 'bin', 'verify-gigl-tracking-worker-capability.sh'), 0o555);
  writeFileSync(join(workerRoot, 'runtime', 'worker.env'), '');
  writeFileSync(join(state, 'crontab'), crontab);
  writeFileSync(join(state, 'systemctl.log'), '');
  writeFileSync(join(state, 'fail-systemctl'), failSystemctl);
  writeFileSync(join(state, 'worker-root-owner-mode'), workerRootOwnerMode);
  writeFileSync(join(state, 'releases-owner-mode'), releasesOwnerMode);
  writeFileSync(join(state, 'active-release-owner-mode'), activeReleaseOwnerMode);

  const mocks = {
    id: `#!/bin/sh\ncase "$1" in\n  -u) echo 0 ;;\n  -g) echo 990 ;;\n  -gn) echo baci-worker ;;\n  -nG) echo 'baci-worker' ;;\n  baci-worker) echo 'uid=990(baci-worker) gid=990(baci-worker)' ;;\n  *) exit 1 ;;\nesac\n`,
    stat: `#!/bin/sh\n# Emulate the provisioned root:baci-locks traversal layout and metadata checks.\nif [ "$3" = -- ]; then target="$4"; else target="$3"; fi\ncase "$target" in\n  ${workerRoot}/runtime/worker.env) echo baci-worker:baci-worker:600 ;;\n  ${workerRoot}) echo "$(cat '${state}/worker-root-owner-mode')" ;;\n  ${workerRoot}/releases) echo "$(cat '${state}/releases-owner-mode')" ;;\n  ${releasePath}) echo "$(cat '${state}/active-release-owner-mode')" ;;\n  ${workerRoot}/locks) echo root:baci-locks:710 ;;\n  ${workerRoot}/logs) echo baci-worker:baci-worker:750 ;;\n  ${workerRoot}/home) echo baci-worker:baci-worker:700 ;;\n  ${root}/backup-store) echo root:root:755 ;;\n  ${backupRoot}/gigl-*) echo root:root:700 ;;\n  ${backupRoot}) echo root:root:700 ;;\n  *) exec /usr/bin/stat "$@" ;;\nesac\n`,
    readlink: `#!/bin/sh\nif [ "$1" = -f ] && [ "$2" = '${workerRoot}/current' ]; then (cd -P "$2" && pwd); else exec /usr/bin/readlink "$@"; fi\n`,
    crontab: `#!/bin/sh\nset -eu\nif [ "$1" = -u ]; then shift 2; fi\nif [ "$1" = -l ]; then cat '${state}/crontab'; exit 0; fi\ncp "$1" '${state}/crontab'\n`,
    install: `#!/bin/sh\nset -eu\nshift 6\ncp "$1" "$2"\nchmod 0644 "$2"\n`,
    systemctl: `#!/bin/sh\nprintf '%s\\n' "$*" >> '${state}/systemctl.log'\nif [ -n "$(cat '${state}/fail-systemctl')" ] && [ "$1" = "$(cat '${state}/fail-systemctl')" ]; then exit 42; fi\n`,
    flock: `#!/bin/sh\nset -eu\ncount=0\n[ ! -f '${state}/flock-count' ] || count=$(cat '${state}/flock-count')\ncount=$((count + 1))\nprintf '%s\\n' "$count" > '${state}/flock-count'\nprintf 'acquire-%s\\n' "$count" >> '${state}/flock.log'\nblock_count=1\n[ ! -f '${state}/block-lock-count' ] || block_count=$(cat '${state}/block-lock-count')\nif [ "$count" = "$block_count" ] && [ -f '${state}/block-first-lock' ]; then\n  while [ ! -f '${state}/release-first-lock' ]; do sleep 0.02; done\nfi\n`,
  };
  for (const [name, content] of Object.entries(mocks)) {
    const path = join(bin, name);
    writeFileSync(path, content);
    chmodSync(path, 0o755);
  }
  const migratedScript = original
    .replaceAll('/srv/baci-workers', workerRoot)
    .replaceAll('/etc/systemd/system', unitDir)
    .replaceAll('/var/lib/baci-workers/gigl-tracking-migration-backups', backupRoot);
  const script = join(root, 'migrate.sh');
  writeFileSync(script, migratedScript);
  const run = (...args) => spawnSync('/bin/bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, GIGL_MIGRATION_TEST_STATE: state },
  });
  const runAsync = (...args) => spawn('/bin/bash', [script, ...args], {
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, GIGL_MIGRATION_TEST_STATE: state },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { root, workerRoot, unitDir, backupRoot, state, run, runAsync, readCron: () => readFileSync(join(state, 'crontab'), 'utf8') };
}

test('migration installs the bounded service/timer and removes only the verified GIGL cron line', (t) => {
  const fx = fixture(t);
  const result = fx.run('migrate');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Rollback snapshot:/);
  assert.match(readFileSync(join(fx.unitDir, 'baci-gigl-tracking.service'), 'utf8'), /User=baci-worker/);
  assert.match(readFileSync(join(fx.unitDir, 'baci-gigl-tracking.service'), 'utf8'), /flock -n .*gigl-tracking\.lock/);
  assert.match(readFileSync(join(fx.unitDir, 'baci-gigl-tracking.service'), 'utf8'), /timeout --signal=TERM --kill-after=30s 2m/);
  assert.match(readFileSync(join(fx.unitDir, 'baci-gigl-tracking.timer'), 'utf8'), /OnCalendar=\*:0\/5/);
  assert.match(fx.readCron(), /^SHELL=\/bin\/bash\n/m);
  assert.match(fx.readCron(), /other-job\.sh/);
  assert.doesNotMatch(fx.readCron(), /process-gigl-tracking\.sh/);
  assert.match(readFileSync(join(fx.state, 'systemctl.log'), 'utf8'), /daemon-reload/);
  assert.match(readFileSync(join(fx.state, 'systemctl.log'), 'utf8'), /enable --now baci-gigl-tracking\.timer/);
  assert.equal(readFileSync(join(fx.state, 'flock.log'), 'utf8'), 'acquire-1\n');
});

test('migration waits for a running legacy poller before starting the new timer', async (t) => {
  const fx = fixture(t);
  writeFileSync(join(fx.state, 'block-first-lock'), '');
  const child = fx.runAsync('migrate');
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.doesNotMatch(readFileSync(join(fx.state, 'systemctl.log'), 'utf8'), /enable --now/);
  assert.match(fx.readCron(), /process-gigl-tracking\.sh/);
  writeFileSync(join(fx.state, 'release-first-lock'), '');
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(status.code, 0, stderr);
  assert.match(stdout, /Rollback snapshot:/);
  assert.match(readFileSync(join(fx.state, 'systemctl.log'), 'utf8'), /enable --now/);
});

test('migration rejects worker roots and release trees that violate broker ownership', (t) => {
  const cases = [
    { workerRootOwnerMode: 'root:root:755', message: /worker root must be owned by root:baci-locks with mode 0710/ },
    { workerRootOwnerMode: 'root:baci-locks:770', message: /worker root must be owned by root:baci-locks with mode 0710/ },
    { releasesOwnerMode: '1001:990:750', message: /worker releases directory must be root-owned/ },
    { activeReleaseOwnerMode: '1001:990:550', message: /active worker release must be root-owned/ },
    { releasesOwnerMode: '0:990:770', message: /worker releases directory must not be group- or world-writable/ },
  ];
  for (const scenario of cases) {
    const fx = fixture(t, scenario);
    const result = fx.run('migrate');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, scenario.message);
    assert.deepEqual(awaitlessList(fx.unitDir), []);
  }
});

test('migration rejects an unsafe locks directory while accepting the provisioned root:baci-locks 0710 layout', (t) => {
  const fx = fixture(t);
  const statPath = join(fx.root, 'mock-bin', 'stat');
  const stat = readFileSync(statPath, 'utf8');
  writeFileSync(statPath, stat.replace('echo root:baci-locks:710 ;;', 'echo baci-worker:baci-worker:750 ;;'));
  chmodSync(statPath, 0o755);
  const result = fx.run('migrate');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /worker locks directory must be owned by root:baci-locks with mode 0710/);
  assert.deepEqual(awaitlessList(fx.unitDir), []);
});

test('ambiguous legacy cron refuses before writing units or changing the crontab', (t) => {
  const cron = (root, lock) => `*/5 * * * * flock -n ${lock} bash -lc '${root}/legacy/bin/process-gigl-tracking.sh'\n*/10 * * * * flock -n ${lock} bash -lc '${root}/legacy/bin/process-gigl-tracking.sh'\n`;
  const fx = fixture(t, { crontab: cron });
  const before = fx.readCron();
  const result = fx.run('migrate');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected exactly one active legacy GIGL cron entry; found 2/);
  assert.equal(fx.readCron(), before);
  assert.deepEqual((awaitlessList(fx.unitDir)), []);
});

test('migration refuses a matching GIGL command on a different interval', (t) => {
  const cron = (root, lock) => `*/15 * * * * flock -n ${lock} bash -lc '${root}/legacy/bin/process-gigl-tracking.sh'\n`;
  const fx = fixture(t, { crontab: cron });
  const before = fx.readCron();
  const result = fx.run('migrate');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /legacy GIGL cron entry is not the expected five-minute schedule/);
  assert.equal(fx.readCron(), before);
  assert.deepEqual(awaitlessList(fx.unitDir), []);
});

test('enable failure restores cron and removes units created by the failed migration', (t) => {
  const fx = fixture(t, { failSystemctl: 'enable' });
  const before = fx.readCron();
  const result = fx.run('migrate');
  assert.notEqual(result.status, 0);
  assert.equal(fx.readCron(), before);
  assert.equal(existsSync(join(fx.unitDir, 'baci-gigl-tracking.service')), false);
  assert.equal(existsSync(join(fx.unitDir, 'baci-gigl-tracking.timer')), false);
  assert.match(readFileSync(join(fx.state, 'systemctl.log'), 'utf8'), /daemon-reload/);
});

test('failure rollback preserves an operator crontab edit made after the migration write', (t) => {
  const fx = fixture(t, { failSystemctl: 'enable' });
  const mockSystemctl = join(fx.root, 'mock-bin', 'systemctl');
  const existing = readFileSync(mockSystemctl, 'utf8');
  writeFileSync(mockSystemctl, existing.replace(
    'then exit 42; fi',
    `then if [ "$1" = enable ]; then printf '%s\\n' 'operator-change' > '${join(fx.state, 'crontab')}'; fi; exit 42; fi`,
  ));
  chmodSync(mockSystemctl, 0o755);
  const result = fx.run('migrate');
  assert.notEqual(result.status, 0);
  assert.equal(fx.readCron(), 'operator-change\n');
  assert.match(result.stderr, /crontab changed during rollback; preserving current operator state/);
});

test('migration refuses a symlinked backup root before creating files outside the worker tree', (t) => {
  const fx = fixture(t);
  const backupRoot = fx.backupRoot;
  const outside = join(fx.root, 'outside-backups');
  mkdirSync(outside);
  mkdirSync(join(fx.root, 'backup-store'));
  rmSync(backupRoot, { recursive: true, force: true });
  // The fixture intentionally starts without migration-backups; point it outside.
  symlinkSync(outside, backupRoot);
  const result = fx.run('migrate');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /migration backup directory must not be a symlink/);
  assert.deepEqual(awaitlessList(fx.unitDir), []);
  assert.deepEqual(readdirSync(outside), []);
});

test('rollback restores the snapshot only when units and migrated cron still match', (t) => {
  const fx = fixture(t);
  const migrated = fx.run('migrate');
  assert.equal(migrated.status, 0, migrated.stderr);
  const backup = migrated.stdout.match(/Rollback snapshot: (\S+)/)?.[1];
  assert.ok(backup);
  const rollback = fx.run('rollback', backup);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.match(fx.readCron(), /process-gigl-tracking\.sh/);
  assert.equal(existsSync(join(fx.unitDir, 'baci-gigl-tracking.service')), false);
  assert.equal(readFileSync(join(fx.state, 'flock.log'), 'utf8'), 'acquire-1\nacquire-2\nacquire-3\n');

  const fx2 = fixture(t);
  const second = fx2.run('migrate');
  const backup2 = second.stdout.match(/Rollback snapshot: (\S+)/)?.[1];
  writeFileSync(join(fx2.state, 'crontab'), 'operator-added-entry\n');
  const refused = fx2.run('rollback', backup2);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /bassey crontab changed since migration/);
  assert.equal(existsSync(join(fx2.unitDir, 'baci-gigl-tracking.service')), true);
});

test('rollback restores the byte-preserved original crontab including trailing blank lines', (t) => {
  const originalCron = (root, lock) => `SHELL=/bin/bash\n*/5 * * * * flock -n ${lock} bash -lc '${root}/legacy/bin/process-gigl-tracking.sh'\n\n\n`;
  const fx = fixture(t, { crontab: originalCron });
  const before = fx.readCron();
  const migrated = fx.run('migrate');
  assert.equal(migrated.status, 0, migrated.stderr);
  const backup = migrated.stdout.match(/Rollback snapshot: (\S+)/)?.[1];
  assert.ok(backup);
  const rollback = fx.run('rollback', backup);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(fx.readCron(), before);
});

test('rollback leaves the legacy schedule disabled when it cannot stop the new timer', (t) => {
  const fx = fixture(t);
  const migrated = fx.run('migrate');
  assert.equal(migrated.status, 0, migrated.stderr);
  const backup = migrated.stdout.match(/Rollback snapshot: (\S+)/)?.[1];
  assert.ok(backup);
  writeFileSync(join(fx.state, 'fail-systemctl'), 'disable');
  const result = fx.run('rollback', backup);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not stop the GIGL timer; legacy crontab remains disabled/);
  assert.doesNotMatch(fx.readCron(), /process-gigl-tracking\.sh/);
  assert.equal(existsSync(join(fx.unitDir, 'baci-gigl-tracking.timer')), true);
});

test('rollback waits for the new service lock before stopping the timer or restoring cron', async (t) => {
  const fx = fixture(t);
  const migrated = fx.run('migrate');
  assert.equal(migrated.status, 0, migrated.stderr);
  const backup = migrated.stdout.match(/Rollback snapshot: (\S+)/)?.[1];
  assert.ok(backup);
  writeFileSync(join(fx.state, 'block-first-lock'), '');
  writeFileSync(join(fx.state, 'block-lock-count'), '2');
  const child = fx.runAsync('rollback', backup);
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.doesNotMatch(readFileSync(join(fx.state, 'systemctl.log'), 'utf8'), /disable --now/);
  assert.doesNotMatch(fx.readCron(), /process-gigl-tracking\.sh/);
  writeFileSync(join(fx.state, 'release-first-lock'), '');
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(status.code, 0, stderr);
  assert.match(fx.readCron(), /process-gigl-tracking\.sh/);
});

function awaitlessList(path) {
  return ['baci-gigl-tracking.service', 'baci-gigl-tracking.timer'].filter((name) => existsSync(join(path, name)));
}
