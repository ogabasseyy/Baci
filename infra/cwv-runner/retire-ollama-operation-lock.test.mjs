import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('acquires one operation lock before both production scan and apply', async () => {
  const source = await readFile(script, 'utf8');
  const lockFunction = source.slice(
    source.indexOf('retirement_lock()'),
    source.indexOf('retirement_prepare()')
  );
  assert.match(source, /--scan\) root; retirement_prepare; scan/);
  assert.match(source, /--apply\) root; retirement_prepare; apply/);
  assert.match(
    source,
    /--recovery-scan\)[^)]*recovery helper missing[^;]*; root; retirement_lock; recovery_scan/
  );
  assert.match(source, /flock=\/usr\/bin\/flock/);
  assert.match(lockFunction, /lock_dir=\/run\/lock\/baci-cwv/);
  assert.match(lockFunction, /mkdir "\$lock_dir"\) \|\| \[ -d "\$lock_dir" \]/);
  assert.match(lockFunction, /stat -c '%u:%a'.*0:700/);
  assert.match(lockFunction, /! -L "\$lock_dir\/retire-ollama\.lock"/);
  assert.match(lockFunction, /exec 9<"\$lock"/);
  assert.doesNotMatch(source, /lock=\/run\/lock\/baci-cwv-retire-ollama\.lock/);
  assert.match(lockFunction, /exec 9>"\$lock"/);
  assert.match(
    source,
    /retirement_prepare\(\) \{ init_temp_root; trap 'cleanup_temp' EXIT HUP INT TERM; retirement_helpers; retirement_lock; \}/
  );
});

test('initializes cleanup-protected storage before helper loading and locking', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-retire-prepare-'));
  const events = join(directory, 'events');
  try {
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `. "$1"; EVENTS=$2; PREPARED=$3; root() { :; }; init_temp_root() { printf 'init\n' >>"$EVENTS"; TEMP_ROOT=$PREPARED; }; cleanup_temp() { :; }; retirement_helpers() { printf 'helpers:%s\n' "$TEMP_ROOT" >>"$EVENTS"; }; retirement_lock() { printf 'lock:%s\n' "$TEMP_ROOT" >>"$EVENTS"; }; scan() { printf 'scan:%s\n' "$TEMP_ROOT" >>"$EVENTS"; }; main --scan; cat "$EVENTS"`,
      `${script.pathname}.source`,
      script.pathname,
      events,
      directory,
    ]);
    assert.equal(
      stdout,
      `init\nhelpers:${directory}\nlock:${directory}\nscan:${directory}\n`
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses scans and recovery scans while apply holds the operation lock', async (t) => {
  if (process.platform !== 'linux') {
    t.skip('the production flock contract executes on Linux');
    return;
  }

  const directory = await mkdtemp(join(tmpdir(), 'baci-retire-lock-'));
  const lock = join(directory, 'operation.lock');
  const ready = join(directory, 'apply-ready');
  const release = join(directory, 'apply-release');
  const scanMarker = join(directory, 'scan-ran');
  const recoveryMarker = join(directory, 'recovery-ran');
  const environment = {
    ...process.env,
    RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
    RETIRE_OLLAMA_FLOCK: '/usr/bin/flock',
    RETIRE_OLLAMA_LOCK: lock,
  };
  const apply = spawn(
    'sh',
    [
      '-c',
      `. "$1"; READY=$2; RELEASE=$3; root() { :; }; retirement_prepare() { retirement_lock; }; apply() { : >"$READY"; while [ ! -e "$RELEASE" ]; do sleep 0.05; done; }; main --apply`,
      `${script.pathname}.source`,
      script.pathname,
      ready,
      release,
    ],
    { env: environment, stdio: ['ignore', 'ignore', 'pipe'] }
  );
  const applyClosed = new Promise((resolve, reject) => {
    apply.once('error', reject);
    apply.once('close', resolve);
  });
  let applyStderr = '';
  apply.stderr.setEncoding('utf8');
  apply.stderr.on('data', (chunk) => {
    applyStderr += chunk;
  });

  try {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try {
        await readFile(ready);
        break;
      } catch {
        if (apply.exitCode !== null || apply.signalCode !== null) {
          throw new Error(
            `apply lock fixture exited before ready: ${applyStderr}`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    await readFile(ready);
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          `. "$1"; SCAN_MARKER=$2; root() { :; }; retirement_prepare() { retirement_lock; }; scan() { : >"$SCAN_MARKER"; }; main --scan`,
          `${script.pathname}.source`,
          script.pathname,
          scanMarker,
        ],
        { env: environment }
      ),
      (error) =>
        error.code === 75 &&
        /another retirement operation owns the lock/.test(error.stderr)
    );
    await assert.rejects(readFile(scanMarker));
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          `. "$1"; RECOVERY_MARKER=$2; root() { :; }; recovery_scan() { : >"$RECOVERY_MARKER"; }; main --recovery-scan`,
          `${script.pathname}.source`,
          script.pathname,
          recoveryMarker,
        ],
        { env: environment }
      ),
      (error) =>
        error.code === 75 &&
        /another retirement operation owns the lock/.test(error.stderr)
    );
    await assert.rejects(readFile(recoveryMarker));
  } finally {
    await writeFile(release, '');
    await Promise.race([
      applyClosed,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('apply lock fixture did not exit')),
          2000
        )
      ),
    ]);
    await rm(directory, { recursive: true, force: true });
  }
});
