import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const emptyPasswdInventory =
  'getent() { [ "$#" -eq 1 ] && [ "$1" = passwd ] || return 2; return 0; };';
const hashTool = ['/usr/bin/sha256sum', '/usr/bin/shasum'].find((path) => {
  return existsSync(path);
});
assert.ok(hashTool, 'a system SHA-256 tool is required for this fixture');
const hashArgs = hashTool.endsWith('shasum') ? ' -a 256' : '';
const testBin = await mkdtemp(join(tmpdir(), 'baci-systemd-consumer-bin-'));
await writeFile(
  join(testBin, 'sha256sum'),
  `#!/bin/sh\nexec ${hashTool}${hashArgs} "$@"\n`
);
await chmod(join(testBin, 'sha256sum'), 0o755);
process.env.RETIRE_OLLAMA_TEST_BIN = testBin;
process.env.RETIRE_OLLAMA_TEST_FSTYPE = 'apfs';
test.after(() => rm(testBin, { recursive: true, force: true }));

function assertFingerprint(fields, offset, expectedPath) {
  assert.equal(fields[offset], expectedPath);
  assert.match(fields[offset + 1], /^[0-9a-f]{64}$/);
  assert.match(fields[offset + 2], /^[0-9a-f]{64}$/);
}

test('finds another unit whose EnvironmentFile consumes Ollama', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-consumer-'))
  );
  const units = join(directory, 'units');
  const environment = join(directory, 'application config.env');
  try {
    await mkdir(units);
    await writeFile(environment, 'OLLAMA_HOST=http://127.0.0.1:11434\n');
    await writeFile(
      join(units, 'application.service'),
      `[Service]\nEnvironmentFile="${environment}"\n`
    );
    await writeFile(
      join(units, 'ollama.service'),
      `[Service]\nEnvironmentFile="${environment}"\n`
    );
    await writeFile(
      join(units, 'uppercase.service'),
      '[Service]\nEnvironment=OLLAMA_HOST=http://127.0.0.1:8080\n'
    );
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'systemctl() { :; }; getent() { return 2; }; stat() { if [ "$1" = -c ] && [ "$2" = %F ]; then printf "regular file\\n"; else printf "1:2:81a4:10:501:20:644\\n"; fi; }; findmnt() { printf "/ fixture apfs ro\\n"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; RECOVERY_RECORDS="[]"; deps="[]"; scan_systemd_consumers; printf "deps=%s\\n" "$deps"',
      'retire-ollama-systemd-consumers-test',
      script.pathname,
      units,
    ]);
    const [direct, consumer, serializedDependencies] = stdout
      .trim()
      .split('\n');
    assertFingerprint(direct.split('|'), 0, join(units, 'uppercase.service'));
    const consumerFields = consumer.split('|');
    assertFingerprint(consumerFields, 0, join(units, 'application.service'));
    assertFingerprint(consumerFields, 3, environment);
    assert.deepEqual(JSON.parse(serializedDependencies.slice('deps='.length)), [
      {
        'key-name': 'environment:OLLAMA_HOST',
        'endpoint-class': 'ollama-loopback',
        'normalized-value-sha256': createHash('sha256')
          .update('http://127.0.0.1:11434')
          .digest('hex'),
        'source-path-sha256': createHash('sha256')
          .update(environment)
          .digest('hex'),
        disposition: 'review',
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('skips a quoted optional missing EnvironmentFile and rejects malformed quotes', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-consumer-quotes-'))
  );
  const units = join(directory, 'units');
  try {
    await mkdir(units);
    await writeFile(
      join(units, 'optional.service'),
      '[Service]\nEnvironmentFile=-"/missing application config.env"\n'
    );
    await execFileAsync('sh', [
      '-c',
      `systemctl() { :; }; ${emptyPasswdInventory} . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
      'retire-ollama-systemd-consumers-optional-test',
      script.pathname,
      units,
    ]);
    await writeFile(
      join(units, 'malformed.service'),
      '[Service]\nEnvironmentFile="/unterminated path\n'
    );
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `systemctl() { :; }; ${emptyPasswdInventory} . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
        'retire-ollama-systemd-consumers-malformed-test',
        script.pathname,
        units,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('finds a loaded transient unit whose runtime environment consumes Ollama', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-systemd-runtime-'));
  try {
    const property = 'Environment=OLLAMA_HOST=http://127.0.0.1:11434';
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `systemctl() { case "$1:$2" in list-units:*) printf "transient.service loaded active running transient\\n";; list-unit-files:*|--user:list-unit-files) return 0;; show:*) printf "Environment=OLLAMA_HOST=http://127.0.0.1:11434\\nEnvironmentFiles=\\nStandardInput=null\\nExecStart={}\\n";; *) return 64;; esac; }; ${emptyPasswdInventory} . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
      'retire-ollama-systemd-runtime-test',
      script.pathname,
      directory,
    ]);
    assert.equal(
      stdout.trim(),
      `transient.service:${createHash('sha256').update(property).digest('hex')}`
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('canonicalizes a merged-usr systemd root before binding consumers', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-consumer-merged-usr-'))
  );
  const canonicalRoot = join(directory, 'usr', 'lib', 'systemd', 'system');
  const configuredAlias = join(directory, 'lib', 'systemd', 'system');
  const definition = join(canonicalRoot, 'foreign.service');
  try {
    await mkdir(canonicalRoot, { recursive: true });
    await symlink('usr/lib', join(directory, 'lib'));
    await writeFile(
      definition,
      '[Service]\nEnvironment=OLLAMA_HOST=http://127.0.0.1:11434\n'
    );
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `systemctl() { case "$1" in list-units) return 0;; esac; }; ${emptyPasswdInventory} stat() { printf "1:2:81a4:10:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2 $3"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
      'retire-ollama-systemd-consumers-merged-usr-test',
      script.pathname,
      configuredAlias,
      canonicalRoot,
    ]);
    const records = stdout.trim().split('\n');
    assert.equal(records.length, 1);
    assertFingerprint(records[0].split('|'), 0, definition);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps colliding system and owner-user linked unit names in separate manifests', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-manifest-collision-'))
  );
  const systemRoot = join(directory, 'system');
  const userHome = join(directory, 'home');
  const userRoot = join(userHome, '.config', 'systemd', 'user');
  const systemTarget = join(directory, 'system-target.service');
  const userTarget = join(directory, 'user-target.service');
  try {
    await Promise.all([
      mkdir(systemRoot),
      mkdir(userRoot, { recursive: true }),
    ]);
    await writeFile(systemTarget, '[Service]\nEnvironment=OTHER=1\n');
    await writeFile(
      userTarget,
      '[Service]\nEnvironment=OLLAMA_HOST=http://127.0.0.1:11434\n'
    );
    await Promise.all([
      symlink(systemTarget, join(systemRoot, 'collision.service')),
      symlink(userTarget, join(userRoot, 'collision.service')),
    ]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'home=$3; getent() { printf "bassey:x:1001:1001::%s:/bin/sh\\n" "$home"; }; systemctl() { return 0; }; stat() { printf "1:2:81a4:10:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; load_consumer_scanners; systemd_user_roots() { [ "$1" = "1001:$home" ] || return 2; printf "%s\\n" "$home/.config/systemd/user"; }; systemd_user_manager_available() { return 1; }; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers',
      'retire-ollama-systemd-manifest-collision-test',
      script.pathname,
      systemRoot,
      userHome,
    ]);
    const fields = stdout.trim().split('|');
    assertFingerprint(fields, 0, userTarget);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('delegates the system manifest to the fixed manager load-path helper', async () => {
  const source = await readFile(
    new URL('./retire-ollama-consumers.sh', import.meta.url),
    'utf8'
  );
  assert.match(source, /systemd_system_roots "\$system_roots"/);
});

test('skips a normal relative systemd alias while scanning its regular target', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-relative-alias-'))
  );
  const definition = join(directory, 'canonical.service');
  try {
    await writeFile(
      definition,
      '[Service]\nEnvironment=OLLAMA_HOST=http://127.0.0.1:11434\n'
    );
    await symlink('canonical.service', join(directory, 'alias.service'));
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'getent() { return 2; }; systemctl() { return 0; }; stat() { printf "1:2:81a4:10:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers',
      'retire-ollama-systemd-relative-alias-test',
      script.pathname,
      directory,
    ]);
    assertFingerprint(stdout.trim().split('|'), 0, definition);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
