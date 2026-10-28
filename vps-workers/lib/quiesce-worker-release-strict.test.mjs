import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

const lib = new URL('./quiesce-worker-release-strict.sh', import.meta.url);

function fixture({ cronExit = 0, queryFailService = '', activeServices = '' } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'strict-worker-quiesce-')));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const workerRoot = join(root, 'worker');
  mkdirSync(join(workerRoot, 'locks'), { recursive: true });
  mkdirSync(join(workerRoot, 'runtime'));
  writeFileSync(join(workerRoot, 'locks', 'error-remediator-global.lock'), '');
  mkdirSync(join(workerRoot, 'bin'));
  writeFileSync(join(workerRoot, 'bin', 'gigl-dotenv.sh'), readFileSync(new URL('../../.github/scripts/gigl-dotenv.sh', import.meta.url), 'utf8'));
  writeFileSync(join(workerRoot, 'runtime', 'worker.env'), '');
  const candidate = join(root, 'candidate.sh');
  writeFileSync(join(root, 'strict-lock-keeper.py'), readFileSync(new URL('./strict-lock-keeper.py', import.meta.url), 'utf8'));
  writeFileSync(candidate, readFileSync(lib, 'utf8').replace("expected_root='/srv/baci-workers'", `expected_root='${workerRoot}'`));
  const log = join(root, 'systemctl.log');
  writeFileSync(log, '');
  const crontab = join(root, 'crontab.txt');
  writeFileSync(crontab, '');
  const stub = (name, source) => writeFileSync(join(bin, name), `#!/bin/sh\n${source}\n`, { mode: 0o755 });
  stub('id', `if [ "$1" = -u ] && [ -n "$2" ]; then echo ${process.getuid()}; elif [ "$1" = -g ] && [ -n "$2" ]; then echo ${process.getgid()}; elif [ "$1" = -u ]; then echo 0; else exit 1; fi`);
  stub('stat', `format="$2"; path="$3"; case "$path" in */runtime/worker.env) metadata="$RUNTIME_ENV_METADATA";; */runtime) metadata="$RUNTIME_METADATA";; */locks) metadata="$LOCK_METADATA";; */locks/*) metadata="$LOCK_FILE_METADATA";; *) metadata="$ROOT_METADATA";; esac; case "$format" in %u:%g) echo "$(echo "$metadata" | cut -d: -f1-2)";; %a) echo "$(echo "$metadata" | cut -d: -f3)";; %u:%g:%a) echo "$(echo "$metadata" | cut -d: -f1-3)";; %u:%g:%a:%h) echo "$(echo "$metadata" | cut -d: -f1-3):1";; *) exit 1;; esac`);
  stub('realpath', `if [ "$1" = -e ]; then echo "$2"; else exit 1; fi`);
  stub('runuser', `if [ "$4" = /usr/bin/touch ]; then /usr/bin/touch -- "$6"; elif [ "$4" = /bin/bash ]; then /bin/bash -c "$6" "$7" "$8" "$9"; elif [ "$4" = python3 ]; then helper="$5"; lock="$6"; uid="$7"; gid="$8"; ready="$9"; release="\${10}"; if [ ${process.getuid()} -eq 0 ]; then python3 "$helper" "$lock" "$uid" "$gid" "$ready" "$release"; else printf 'READY\\n' > "$ready"; cat "$release" >/dev/null; fi; else exit 1; fi`);
  stub('flock', `python3 - "$@" <<'PY'
import fcntl, os, sys
args = sys.argv[1:]
while args and args[0] in ('-w', '-n', '-x'):
    flag = args.pop(0)
    if flag == '-w' and args:
        args.pop(0)
target = args.pop(0)
fd = int(target) if target.isdigit() else os.open(target, os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | (fcntl.LOCK_NB if '-n' in sys.argv else 0))
except BlockingIOError:
    sys.exit(1)
PY`);
  stub('crontab', `if [ "$CRONTAB_EXIT" != 0 ]; then exit "$CRONTAB_EXIT"; fi\ncat "$CRONTAB_FIXTURE"`);
  stub('systemctl', `echo "$*" >> "$SYSTEMCTL_LOG"\nif [ "$1" = is-active ]; then\n  [ "$3" = "$SYSTEMD_QUERY_FAIL_SERVICE" ] && exit 1\n  case " $ACTIVE_SERVICES " in *" $3 "*) exit 0;; *) exit 3;; esac\nfi\n[ "$1:$2" = "start:$SYSTEMD_START_FAIL_SERVICE" ] && exit 1\nexit 0`);
  const driver = join(root, 'driver.sh');
  writeFileSync(driver, `#!/bin/bash\nset -eo pipefail\n. "${candidate}"\ntrap 'echo PRIOR-EXIT >> "$SYSTEMCTL_LOG"' EXIT\nstrict_worker_release_quiesce '${workerRoot}' || exit 3\necho QUIESCE-OK\n`, { mode: 0o755 });
  return { root, bin, log, crontab, driver, candidate, workerRoot, cronExit, queryFailService, activeServices };
}

function run(f, driver = f.driver, extraEnv = {}) {
  return spawnSync('bash', [driver], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH}`,
      SYSTEMCTL_LOG: f.log,
      CRONTAB_FIXTURE: f.crontab,
      CRONTAB_EXIT: String(f.cronExit),
      SYSTEMD_QUERY_FAIL_SERVICE: f.queryFailService,
      ACTIVE_SERVICES: f.activeServices,
      SYSTEMD_START_FAIL_SERVICE: extraEnv.SYSTEMD_START_FAIL_SERVICE ?? '',
      ROOT_METADATA: `0:${process.getgid()}:710`,
      RUNTIME_METADATA: `${process.getuid()}:${process.getgid()}:700`,
      RUNTIME_ENV_METADATA: `${process.getuid()}:${process.getgid()}:600`,
      LOCK_METADATA: `0:${process.getgid()}:710`,
      LOCK_FILE_METADATA: `0:${process.getgid()}:660`,
      ...extraEnv,
    },
  });
}

describe('strict worker release quiescence candidate', () => {
  it('fails closed on worker crontab lookup failure before touching systemd', () => {
    const f = fixture({ cronExit: 1 });
    try {
      const result = run(f);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /release crontab lookup failed/);
      assert.doesNotMatch(readFileSync(f.log, 'utf8'), /is-active|stop/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it('fails closed on system bus/query errors and restores services already stopped', () => {
    const f = fixture({ queryFailService: 'baci-event-delivery-worker', activeServices: 'baci-domain-event-router' });
    try {
      const result = run(f);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /systemd query failed/);
      const calls = readFileSync(f.log, 'utf8');
      assert.match(calls, /stop baci-domain-event-router/);
      assert.match(calls, /start baci-domain-event-router/);
      assert.match(calls, /PRIOR-EXIT/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it('keeps service state globally through function return and chains the prior EXIT trap', () => {
    const f = fixture({ activeServices: 'baci-domain-event-router' });
    try {
      const result = run(f);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /QUIESCE-OK/);
      const calls = readFileSync(f.log, 'utf8');
      assert.match(calls, /stop baci-domain-event-router/);
      assert.match(calls, /start baci-domain-event-router/);
      assert.match(calls, /PRIOR-EXIT/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it('reports lease cleanup failure when a previously active service cannot restart', () => {
    const f = fixture({ activeServices: 'baci-domain-event-router' });
    try {
      const result = run(f, f.driver, { SYSTEMD_START_FAIL_SERVICE: 'baci-domain-event-router' });
      assert.equal(result.status, 1, 'cleanup failure must become the process result, not a confirmed lease release');
      const calls = readFileSync(f.log, 'utf8');
      assert.match(calls, /stop baci-domain-event-router/);
      assert.match(calls, /start baci-domain-event-router/);
      assert.match(calls, /PRIOR-EXIT/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it('retains each cron lock in first-seen order and defers the fixed global lock', () => {
    const f = fixture();
    const locks = join(f.root, 'locks');
    mkdirSync(locks);
    writeFileSync(join(locks, 'aaa.lock'), '');
    writeFileSync(join(locks, 'leftover.lock'), '');
    const cron = `* * * * * flock ${locks}/job-b.lock ${locks}/error-remediator-global.lock ${locks}/job-a.lock\n`;
    const global = join(locks, 'error-remediator-global.lock');
    try {
      const command = `. "${lib.pathname}"; _strict_worker_release_order_lock_paths '${cron}' '${locks}' '${global}'`;
      const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.trim().split('\n'), [
        join(locks, 'job-b.lock'), join(locks, 'job-a.lock'), join(locks, 'aaa.lock'), join(locks, 'leftover.lock'),
      ]);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it('refuses legacy cron lock paths instead of mapping them onto different release inodes', () => {
    const locks = '/srv/baci-workers/locks';
    const legacyCron = '* * * * * flock -n /home/bassey/baci-workers/locks/gigl-tracking.lock true\n';
    const command = `. "${lib.pathname}"; _strict_worker_release_order_lock_paths '${legacyCron}' '${locks}' '${locks}/error-remediator-global.lock'`;
    const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the trusted release namespace/);
  });

  it('holds acquired flock descriptors until the caller shell exits', { skip: process.getuid() !== 0 }, async () => {
    const f = fixture();
    const lock = join(f.root, 'release.lock');
    const secondLock = join(f.root, 'release-second.lock');
    const driver = join(f.root, 'hold-lock.sh');
    writeFileSync(lock, '');
    writeFileSync(secondLock, '');
    chmodSync(lock, 0o660);
    chmodSync(secondLock, 0o660);
    writeFileSync(driver, `. "${lib.pathname}"\n_strict_worker_release_active=1\n_strict_worker_release_fds=()\n_strict_worker_release_pids=()\n_strict_worker_release_ipc=()\n_strict_worker_release_hold_lock '${lock}' baci-worker "$(id -u baci-worker)" "$(id -g baci-worker)" "$(id -g baci-locks)" || exit 1\n_strict_worker_release_hold_lock '${secondLock}' baci-worker "$(id -u baci-worker)" "$(id -g baci-worker)" "$(id -g baci-locks)" || exit 1\necho READY\nread -r _\n`, { mode: 0o755 });
    const child = spawn('bash', [driver], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}` } });
    try {
      await new Promise((resolve, reject) => {
        let output = '';
        let error = '';
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          if (output.includes('READY')) resolve();
        });
        child.stderr.on('data', (chunk) => { error += chunk.toString(); });
        child.once('error', reject);
        child.once('exit', (code) => { if (code !== 0) reject(new Error(`lock holder exited ${code}: ${output} ${error}`)); });
      });
      const whileHeld = spawnSync(join(f.bin, 'flock'), ['-n', lock, 'true'], { encoding: 'utf8' });
      assert.notEqual(whileHeld.status, 0, 'another process must not acquire the held lock');
      const secondWhileHeld = spawnSync(join(f.bin, 'flock'), ['-n', secondLock, 'true'], { encoding: 'utf8' });
      assert.notEqual(secondWhileHeld.status, 0, 'another process must not acquire the second held lock');
      child.stdin.end('\n');
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`lock holder exited ${code}`)));
      });
      const afterExit = spawnSync(join(f.bin, 'flock'), ['-n', lock, 'true'], { encoding: 'utf8' });
      assert.equal(afterExit.status, 0, afterExit.stderr);
      const secondAfterExit = spawnSync(join(f.bin, 'flock'), ['-n', secondLock, 'true'], { encoding: 'utf8' });
      assert.equal(secondAfterExit.status, 0, secondAfterExit.stderr);
    } finally {
      child.kill();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('rejects symlinked lock files and symlinked parent directories without touching targets', () => {
    const f = fixture();
    const target = join(f.root, 'outside.lock');
    const linkDir = join(f.root, 'linked-dir');
    const externalDir = join(f.root, 'external');
    mkdirSync(externalDir);
    writeFileSync(target, 'sentinel');
    symlinkSync(target, join(f.workerRoot, 'locks', 'linked.lock'));
    symlinkSync(externalDir, linkDir);
    const helper = new URL('./strict-lock-keeper.py', import.meta.url);
    try {
      const linkedFile = spawnSync('python3', [helper.pathname, join(f.workerRoot, 'locks', 'linked.lock'), String(process.getuid()), String(process.getgid()), '', ''], { encoding: 'utf8' });
      assert.notEqual(linkedFile.status, 0);
      const linkedParent = spawnSync('python3', [helper.pathname, join(linkDir, 'created.lock'), String(process.getuid()), String(process.getgid()), '', ''], { encoding: 'utf8' });
      assert.notEqual(linkedParent.status, 0);
      assert.equal(readFileSync(target, 'utf8'), 'sentinel');
      assert.equal(existsSync(join(externalDir, 'created.lock')), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it('pins the dedicated identity and root and leaves the adapter disabled', () => {
    const source = readFileSync(lib, 'utf8');
    assert.match(source, /expected_root='\/srv\/baci-workers'/);
    assert.match(source, /expected_user='baci-worker'/);
    assert.match(source, /"0:\$expected_lock_gid"/);
    assert.match(source, /crontab -u "\$expected_cron_user" -l/);
    assert.match(source, /runtime\/worker\.env/);
    const adapter = readFileSync(new URL('./worker-release-quiesce-adapter.mjs', import.meta.url), 'utf8');
    assert.match(adapter, /enabled: false/);
  });

  it('fails closed unless the root is root-owned and worker-group-owned', () => {
    const f = fixture();
    try {
      const result = run(f, f.driver, { ROOT_METADATA: '2201:2201:710' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /worker root ownership is unverified/);
      assert.doesNotMatch(readFileSync(f.log, 'utf8'), /is-active|stop/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it('rejects a configured global lock that aliases the inherited GIGL lock', () => {
    const f = fixture();
    try {
      writeFileSync(join(f.workerRoot, 'runtime', 'worker.env'), 'BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/gigl-tracking.lock\n');
      writeFileSync(join(f.workerRoot, 'locks', 'gigl-tracking.lock'), '');
      const result = run(f);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /aliases the inherited GIGL lock/);
      assert.doesNotMatch(readFileSync(f.log, 'utf8'), /is-active|stop/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it('fails closed when the isolated worker runtime env is absent', () => {
    const f = fixture();
    try {
      rmSync(join(f.workerRoot, 'runtime', 'worker.env'));
      const result = run(f);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /remediation global lock could not be resolved safely/);
      assert.doesNotMatch(readFileSync(f.log, 'utf8'), /is-active|stop/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it('uses a root-owned non-replaceable lock namespace and private IPC', () => {
    const keeper = readFileSync(new URL('./strict-lock-keeper.py', import.meta.url), 'utf8');
    const source = readFileSync(lib, 'utf8');
    assert.match(keeper, /parts\[-1\], os\.O_RDWR \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/);
    assert.doesNotMatch(keeper, /os\.O_CREAT/);
    assert.match(keeper, /parent\.st_uid != 0/);
    assert.match(keeper, /info\.st_uid != 0/);
    assert.match(source, /chown "\$uid:\$worker_gid" "\$ipc_dir" && chmod 700/);
    assert.match(source, /mkfifo -m 600/);
    assert.match(source, /chown "\$uid:\$worker_gid" "\$ready_fifo" "\$release_fifo"/);
  });
});
