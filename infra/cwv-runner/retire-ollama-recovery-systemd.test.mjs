import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
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
async function shell(command, env = {}, args = []) {
  const bin = await testBin();
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; [ -z "\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}" ] || RECOVERY_RECEIPT_ROOT="\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}"; ${command}`,
      'recovery-systemd-test',
      script.pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...env,
      },
    }
  ).finally(() => rm(bin, { recursive: true, force: true }));
}

test('rejects a root recovery helper outside the sealed source root', async () => {
  const sourceSha = 'a'.repeat(40);
  await assert.rejects(
    shell(
      `id() { printf "0\\n"; }; SCRIPT_DIR="/tmp/${sourceSha}"; recovery_source_identity "${sourceSha}"`
    ),
    (error) => error.code === 1
  );
});
test('refuses a systemd scan when its record accumulator is malformed', async () => {
  await assert.rejects(
    shell(
      'recovery_surface() { :; }; recovery_systemd_properties() { : >"$3"; return 4; }; RECOVERY_RECORDS="{malformed"; UNIT=ollama.service; TIMER=ollama-watchdog.timer; init_temp_root; trap cleanup_temp EXIT; recovery_collect_systemd'
    ),
    (error) =>
      /recovery systemd property serialization failed/.test(
        String(error.stderr)
      )
  );
});
test('excludes Ollama serve cron jobs from recovery consumer evidence', async () => {
  const { stdout } = await shell(
    'RECOVERY_RECORDS="[]"; deps="[]"; consumer_counts="[]"; consumer_evidence="[]"; init_temp_root; trap cleanup_temp EXIT; approved="0 * * * * /usr/bin/ollama serve"; OLLAMA_CRON_ONE=$(hash_text "$approved"); cron=$(temp_path); printf "%s\\n%s\\n" "$approved" "0 * * * * /usr/bin/other" >"$cron"; recovery_surface current-crontab cat "$cron"; printf "%s\\n%s\\n" "$consumer_counts" "$consumer_evidence"'
  );
  const [counts, evidence] = stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(counts, [{ surface: 'current-crontab', matchCount: 0 }]);
  assert.deepEqual(evidence, []);
});
test('rejects Ollama subcommand prefixes without a token boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-ollama-recovery-argv-'));
  const procRoot = join(directory, 'proc');
  const processes = join(directory, 'processes');
  const ports = join(directory, 'ports.json');
  const command =
    'recovery_process_identity() { printf "container-cgroup container-ns\\n"; }; recovery_process_executable() { printf "{\\"path\\":\\"/usr/bin/ollama\\",\\"sha256\\":\\"%064d\\",\\"identitySha256\\":\\"%064d\\",\\"uid\\":\\"1000\\",\\"startTime\\":\\"1\\",\\"expected\\":\\"/bin/ollama\\"}\\n" 0 0; }; init_temp_root; trap cleanup_temp EXIT; recovery_process_snapshot 41 container-cgroup container-ns "$2" "$3"';
  try {
    await mkdir(join(procRoot, 'net'), { recursive: true });
    await Promise.all([
      writeFile(
        join(procRoot, 'net', 'tcp'),
        'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
      ),
      writeFile(
        join(procRoot, 'net', 'tcp6'),
        'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
      ),
    ]);
    await writeFile(ports, '{}\n');
    for (const subcommand of ['serve-malicious', 'runner-malicious']) {
      await writeFile(processes, `41 1 /usr/bin/ollama ${subcommand}\n`);
      await assert.rejects(
        shell(`RECOVERY_PROC_ROOT="$4"; ${command}`, {}, [
          ports,
          processes,
          procRoot,
        ]),
        (error) =>
          error.code === 78 && /unsupported Ollama process/.test(error.stderr)
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('rejects a loopback listener whose argv omits Ollama and the port', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-socket-')
  );
  const procRoot = join(directory, 'proc');
  const ports = join(directory, 'ports.json');
  const processes = join(directory, 'processes');
  try {
    await mkdir(join(procRoot, 'net'), { recursive: true });
    await mkdir(join(procRoot, '41', 'fd'), { recursive: true });
    await mkdir(join(procRoot, '43', 'fd'), { recursive: true });
    await symlink('socket:[12345]', join(procRoot, '43', 'fd', '7'));
    await writeFile(
      join(procRoot, 'net', 'tcp'),
      '  sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n0: 0100007F:2CAA 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 12345\n'
    );
    await writeFile(
      join(procRoot, 'net', 'tcp6'),
      '  sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
    );
    await writeFile(ports, '{}\n');
    await writeFile(
      processes,
      '41 1 /usr/bin/ollama serve\n43 1 /usr/bin/python server.py\n'
    );
    await assert.rejects(
      shell(
        'RECOVERY_PROC_ROOT="$2"; recovery_process_identity() { printf "container-cgroup container-ns\\n"; }; recovery_process_executable() { printf "{\\"path\\":\\"/usr/bin/ollama\\",\\"sha256\\":\\"%064d\\",\\"identitySha256\\":\\"%064d\\",\\"uid\\":\\"1000\\",\\"startTime\\":\\"1\\"}\\n" 0 0; }; recovery_listener_executable() { printf "{\\"path\\":\\"/usr/bin/python\\",\\"realPath\\":\\"/usr/bin/python\\",\\"sha256\\":\\"%064d\\",\\"identitySha256\\":\\"%064d\\",\\"uid\\":\\"1000\\",\\"startTime\\":\\"1\\"}\\n" 0 0; }; init_temp_root; trap cleanup_temp EXIT; recovery_process_snapshot 41 container-cgroup container-ns "$3" "$4"',
        {},
        [procRoot, ports, processes]
      ),
      (error) =>
        error.code === 78 && /unreviewed port-11434 listener/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('binds a reviewed listener socket inode to its process evidence', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-socket-bound-')
  );
  const procRoot = join(directory, 'proc');
  const ports = join(directory, 'ports.json');
  const processes = join(directory, 'processes');
  try {
    await mkdir(join(procRoot, 'net'), { recursive: true });
    await mkdir(join(procRoot, '41', 'fd'), { recursive: true });
    await symlink('socket:[12345]', join(procRoot, '41', 'fd', '7'));
    await writeFile(
      join(procRoot, 'net', 'tcp'),
      '  sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n0: 0100007F:2CAA 00000000:0000 0A 00000000:00000000 00:00000000 00:00000000 1000 0 12345\n'
    );
    await writeFile(
      join(procRoot, 'net', 'tcp6'),
      '  sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
    );
    await writeFile(
      ports,
      '{"HostConfig":{"PortBindings":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]}},"NetworkSettings":{"Ports":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]},"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}}}\n'
    );
    await writeFile(processes, '41 1 /usr/bin/ollama serve\n');
    const { stdout } = await shell(
      'RECOVERY_PROC_ROOT="$2"; recovery_process_identity() { printf "container-cgroup container-ns\\n"; }; recovery_process_executable() { printf "{\\"path\\":\\"/usr/bin/ollama\\",\\"sha256\\":\\"%064d\\",\\"identitySha256\\":\\"%064d\\",\\"uid\\":\\"1000\\",\\"startTime\\":\\"1\\"}\\n" 0 0; }; recovery_listener_executable() { printf "{\\"path\\":\\"/usr/bin/ollama\\",\\"realPath\\":\\"/usr/bin/ollama\\",\\"sha256\\":\\"%064d\\",\\"identitySha256\\":\\"%064d\\",\\"uid\\":\\"1000\\",\\"startTime\\":\\"1\\"}\\n" 0 0; }; init_temp_root; trap cleanup_temp EXIT; recovery_process_snapshot 41 container-cgroup container-ns "$3" "$4"',
      {},
      [procRoot, ports, processes]
    );
    const snapshot = JSON.parse(stdout);
    assert.deepEqual(snapshot.listeningSockets, [
      {
        class: 'container',
        executable: {
          identitySha256: '0'.repeat(64),
          path: '/usr/bin/ollama',
          sha256: '0'.repeat(64),
          startTime: '1',
          uid: '1000',
        },
        family: 'tcp',
        inode: '12345',
        localAddressHex: '0100007F',
        pid: '41',
        port: 11434,
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function testBin() {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-systemd-bin-')
  );
  await writeFile(
    join(directory, 'sha256sum'),
    '#!/bin/sh\nexec /usr/bin/shasum -a 256 "$@"\n'
  );
  await chmod(join(directory, 'sha256sum'), 0o755);
  return directory;
}

test('parses systemd EnvironmentFiles annotations and preserves optionality', async () => {
  const bin = await testBin();
  try {
    const { stdout } = await shell(
      'recovery_surface() { :; }; recovery_systemd_properties() { if [ "$2" = EnvironmentFiles ]; then printf "/etc/ollama-optional.env (ignore_errors=yes) /etc/ollama-required.env (ignore_errors=no)\\n" >"$3"; return 0; fi; : >"$3"; return 4; }; recovery_record_environment() { printf "%s:%s\\n" "$1" "$2"; }; RECOVERY_RECORDS="[]"; UNIT=ollama.service; TIMER=ollama-watchdog.timer; init_temp_root; trap cleanup_temp EXIT; recovery_collect_systemd',
      { RETIRE_OLLAMA_TEST_BIN: bin }
    );
    assert.deepEqual(stdout.trim().split('\n'), [
      '/etc/ollama-optional.env:1',
      '/etc/ollama-required.env:0',
      '/etc/ollama-optional.env:1',
      '/etc/ollama-required.env:0',
    ]);
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
});

test('parses systemd EnvironmentFile comments, continuations, and quoted values', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-environment-')
  );
  const environment = join(directory, 'ollama.env');
  try {
    await writeFile(
      environment,
      '; systemd comment\n# shell-style comment\nOLLAMA_HOST="http://127.0.0.1:11434"\nOLLAMA_MODELS=/var/lib/ollama\\\n/models\nOLLAMA_ARGS="serve \\\n--port=11434"\n'
    );
    const { stdout } = await shell(
      'recovery_record_path() { RECOVERY_REFERENCE_SNAPSHOT=$2; }; record_dependency() { printf "%s=%s\\n" "$1" "$2"; }; init_temp_root; trap cleanup_temp EXIT; recovery_record_environment "$2" 0',
      {},
      [environment]
    );
    assert.deepEqual(stdout.trim().split('\n'), [
      'environment:OLLAMA_HOST=http://127.0.0.1:11434',
      'environment:OLLAMA_MODELS=/var/lib/ollama/models',
      'environment:OLLAMA_ARGS=serve --port=11434',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unknown or contradictory systemd EnvironmentFiles annotations', async () => {
  const bin = await testBin();
  try {
    await assert.rejects(
      shell(
        'recovery_surface() { :; }; recovery_systemd_properties() { if [ "$2" = EnvironmentFiles ]; then printf "/etc/ollama.env (ignore_errors=maybe)\\n" >"$3"; return 0; fi; : >"$3"; return 4; }; recovery_record_environment() { :; }; RECOVERY_RECORDS="[]"; UNIT=ollama.service; TIMER=ollama-watchdog.timer; init_temp_root; trap cleanup_temp EXIT; recovery_collect_systemd',
        { RETIRE_OLLAMA_TEST_BIN: bin }
      ),
      (error) =>
        error.code === 65 &&
        /unknown recovery EnvironmentFiles annotation/.test(error.stderr)
    );
    await assert.rejects(
      shell(
        'recovery_surface() { :; }; recovery_systemd_properties() { if [ "$2" = EnvironmentFiles ]; then printf "%s\\n" "-/etc/ollama.env (ignore_errors=no)" >"$3"; return 0; fi; : >"$3"; return 4; }; recovery_record_environment() { :; }; RECOVERY_RECORDS="[]"; UNIT=ollama.service; TIMER=ollama-watchdog.timer; init_temp_root; trap cleanup_temp EXIT; recovery_collect_systemd',
        { RETIRE_OLLAMA_TEST_BIN: bin }
      ),
      (error) => error.code === 65 && /optionality drift/.test(error.stderr)
    );
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
});

test('retains parsed unit activity and enablement states in recovery evidence', async () => {
  const bin = await testBin();
  try {
    const { stdout } = await shell(
      'recovery_systemctl() { case "$2" in ollama.service) printf "LoadState=loaded\\nUnitFileState=enabled\\nActiveState=active\\n";; ollama-watchdog.timer) printf "LoadState=loaded\\nUnitFileState=disabled\\nActiveState=inactive\\n";; esac; }; init_temp_root; trap cleanup_temp EXIT; recovery_unit_snapshot ollama.service; recovery_unit_snapshot ollama-watchdog.timer',
      { RETIRE_OLLAMA_TEST_BIN: bin }
    );
    const [active, inactive] = stdout.trim().split('\n').map(JSON.parse);
    assert.equal(active.name, 'ollama.service');
    assert.equal(active.state, 'present');
    assert.equal(active.loadState, 'loaded');
    assert.equal(active.unitFileState, 'enabled');
    assert.equal(active.activeState, 'active');
    assert.match(active.stateSha256, /^[0-9a-f]{64}$/);
    assert.equal(inactive.unitFileState, 'disabled');
    assert.equal(inactive.activeState, 'inactive');
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
});

test('retains an absent systemd property status for its caller', async () => {
  const { stdout } = await shell(
    'recovery_systemctl() { return 4; }; init_temp_root; trap cleanup_temp EXIT; out=$(temp_path); if recovery_systemd_properties ollama.service EnvironmentFiles "$out"; then exit 1; else status=$?; fi; printf "%s:%s\\n" "$status" "$(wc -c <"$out")"'
  );
  assert.match(stdout.trim(), /^4:\s*0$/);
});
