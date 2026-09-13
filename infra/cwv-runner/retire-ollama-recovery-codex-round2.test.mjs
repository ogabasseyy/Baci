import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const sourceSha = 'c'.repeat(40);
const childCredentials =
  process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const childIdentity = `${childCredentials.uid ?? process.getuid?.()}:${childCredentials.gid ?? process.getgid?.()}`;
function shell(command, args = [], env = {}, options = {}) {
  const { env: optionEnv = {}, ...execOptions } = options;
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; [ -z "\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}" ] || RECOVERY_RECEIPT_ROOT="\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}"; ${command}`,
      'recovery-codex-round2-test',
      script.pathname,
      ...args,
    ],
    {
      ...execOptions,
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: '/sbin',
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...optionEnv,
        ...env,
      },
    }
  );
}
function fixtureShell(command, args = [], env = {}) {
  return shell(
    `[ "$(id -u):$(id -g)" = "$RETIRE_OLLAMA_EXPECT_TEST_ID" ] || exit 79; ${command}`,
    args,
    { ...env, RETIRE_OLLAMA_EXPECT_TEST_ID: childIdentity },
    childCredentials
  );
}

async function testBin() {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-codex-bin-')
  );
  await writeFile(
    join(directory, 'sha256sum'),
    '#!/bin/sh\nexec /usr/bin/shasum -a 256 "$@"\n'
  );
  await writeFile(
    join(directory, 'ln'),
    '#!/bin/sh\n[ "$1" = -- ] && shift\nexec /bin/ln "$@"\n'
  );
  await writeFile(
    join(directory, 'readlink'),
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),p=a.at(-1);if(a[0]==='-f')process.stdout.write((process.env.RETIRE_OLLAMA_TEST_REALPATH?fs.realpathSync(p):p)+'\\n');else if(a[0]==='--')process.stdout.write(fs.readlinkSync(p)+'\\n');else process.exit(1);\n`
  );
  await writeFile(
    join(directory, 'stat'),
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),i=a.indexOf('-c'),f=i>=0?a[i+1]:a.find(v=>v.startsWith('--format='))?.slice(9),p=a.at(-1),s=(a.includes('-L')||a.includes('-Lc')?fs.statSync:fs.lstatSync)(p),m=s.mode&0o7777,t=s.mode.toString(16),type=(s.mode&0o170000)===0o040000?'directory':(s.mode&0o170000)===0o120000?'symbolic link':'regular file';const r=(f??'%a').replaceAll('%u',String(s.uid)).replaceAll('%g',String(s.gid)).replaceAll('%a',m.toString(8)).replaceAll('%d',String(s.dev)).replaceAll('%i',String(s.ino)).replaceAll('%f',t).replaceAll('%F',type);process.stdout.write(r+'\\n');\n`
  );
  await Promise.all(
    ['sha256sum', 'ln', 'readlink', 'stat'].map((name) =>
      chmod(join(directory, name), 0o755)
    )
  );
  return directory;
}

async function snapshotFile(directory, value) {
  const snapshot = join(directory, 'snapshot.json');
  await writeFile(snapshot, `${JSON.stringify(value)}\n`);
  return snapshot;
}
async function emptyProc(root) {
  await mkdir(join(root, 'net'), { recursive: true });
  await Promise.all([chmod(root, 0o755), chmod(join(root, 'net'), 0o755)]);
  await Promise.all(
    ['tcp', 'tcp6'].map((name) =>
      writeFile(
        join(root, 'net', name),
        'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
      ).then(() => chmod(join(root, 'net', name), 0o644))
    )
  );
}

test('completes an absent-container recovery scan without a ports temp', async () => {
  const { stdout } = await shell(
    `root() { :; }; SCRIPT_DIR="/srv/baci-cwv/source/${sourceSha}"; RECOVERY_SOURCE_SHA="${sourceSha}"; assert_docker_socket() { CANONICAL_DOCKER_SOCKET=/run/docker.sock; }; recovery_collect_systemd() { :; }; recovery_surface() { :; }; recovery_container_snapshot() { RECOVERY_CONTAINER_STATE=absent; printf '%s\\n' '{"name":"ollama-loopback","state":"absent"}'; }; recovery_docker() { [ "$1" = inspect ] || return 64; printf '%s\\n' 'Error: No such object: ollama-loopback' >&2; return 1; }; recovery_collect_processes() { : >"$1"; }; recovery_collect_crontab() { : >"$1"; }; recovery_record_external_cron_sources() { :; }; recovery_absent_process_snapshot() { printf '%s\\n' '{"state":"absent","matchingProcesses":[],"listeningSockets":[],"socketSnapshotSha256":"0000000000000000000000000000000000000000000000000000000000000000"}'; }; recovery_package_snapshot() { printf '%s\\n' '{"name":"ollama","state":"absent","version":null}'; }; recovery_unit_snapshot() { printf '{"name":"%s","state":"absent"}\\n' "$1"; }; recovery_model_snapshot() { printf '%s\\n' '{"state":"absent"}'; }; recovery_cron_snapshot() { printf '%s\\n' '{"wholeSha256":"0000000000000000000000000000000000000000000000000000000000000000","lineCount":0,"lines":[]}'; }; record_docker_socket() { :; }; recovery_write_receipt() { [ -s "$1" ] || return 65; printf '%s' "$RECOVERY_SOURCE_SHA"; }; recovery_scan`,
    [],
    {
      RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
      RETIRE_OLLAMA_RECOVERY_TEST_SOURCE_SHA: 'd'.repeat(40),
    }
  );
  assert.equal(stdout, process.getuid?.() === 0 ? sourceSha : 'd'.repeat(40));
});

test('ignores the recovery scanner ancestry in absent-container evidence', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-absent-scanner-')
  );
  const proc = join(directory, 'proc');
  const processes = join(directory, 'processes');
  try {
    await chmod(directory, 0o755);
    await emptyProc(proc);
    await writeFile(processes, '');
    await chmod(processes, 0o644);
    const { stdout } = await fixtureShell(
      'RECOVERY_PROC_ROOT="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_build_scanner_ancestors() { RECOVERY_SCANNER_PID_SET=" $$"; }; printf "%s 1 /bin/sh %s/retire-ollama.sh --recovery-scan\\n" "$$" "$SCRIPT_DIR" >"$2"; recovery_absent_process_snapshot "$2"',
      [processes, proc]
    );
    const snapshot = JSON.parse(stdout);
    assert.equal(snapshot.state, 'absent');
    assert.deepEqual(snapshot.matchingProcesses, []);
    assert.deepEqual(snapshot.listeningSockets, []);
    assert.match(snapshot.socketSnapshotSha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reconciles a JSON link left by an interrupted publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-json-link-'));
  const receiptRoot = join(directory, 'receipts');
  const bin = await testBin();
  const snapshot = await snapshotFile(directory, {
    surfaces: [],
    dependencies: [],
    consumerCounts: [],
    consumerEvidence: [],
  });
  const json = join(receiptRoot, sourceSha, 'recovery-scan.json');
  const digest = `${json}.sha256`;
  try {
    const { stdout } = await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$5"; RETIRE_OLLAMA_RECOVERY_TEST_ROOT="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"; mv "$6" "$6.pending"; ln -- "$6.pending" "$6"; ln -- "$6.pending" "$3/$5/.recovery-publish.json"; mv "$4" "$4.pending"; recovery_write_receipt "$2"',
      [snapshot, receiptRoot, digest, sourceSha, json],
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
      }
    );
    assert.equal(stdout.trim().split('\n').length, 2);
    assert.equal(
      (await readFile(digest, 'utf8')).trim(),
      createHash('sha256')
        .update(await readFile(json))
        .digest('hex')
    );
    await assert.rejects(readFile(`${json}.pending`));
    await assert.rejects(
      readFile(join(receiptRoot, sourceSha, '.recovery-publish.json'))
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('ignores unrelated Docker proxies while retaining the reviewed binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-proxy-scope-'));
  const proc = join(directory, 'proc');
  const processes = join(directory, 'processes');
  const ports = join(directory, 'ports.json');
  try {
    await chmod(directory, 0o755);
    await emptyProc(proc);
    await writeFile(
      processes,
      '41 1 /usr/bin/ollama serve\n42 1 /usr/bin/docker-proxy -proto tcp -host-ip 127.0.0.1 -host-port 11434 -container-ip 172.17.0.2 -container-port 11434\n43 1 /usr/bin/docker-proxy -proto tcp -host-ip 127.0.0.1 -host-port 8080 -container-ip 172.17.0.3 -container-port 8080\n'
    );
    await writeFile(
      ports,
      '{"NetworkSettings":{"Ports":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]},"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}}}\n'
    );
    await Promise.all([chmod(processes, 0o644), chmod(ports, 0o644)]);
    const { stdout } = await fixtureShell(
      'RECOVERY_PROC_ROOT="$4"; recovery_process_identity() { case "$1" in 41) printf "container-cgroup container-ns\\n";; 42) printf "proxy-cgroup proxy-ns\\n";; *) printf "foreign-cgroup foreign-ns\\n";; esac; }; recovery_process_executable() { printf "{\\"path\\":\\"/usr/bin/%s\\",\\"sha256\\":\\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\",\\"identitySha256\\":\\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\",\\"uid\\":\\"0\\",\\"startTime\\":\\"1\\",\\"expected\\":\\"%s\\"}\\n" "$2" "$2"; }; init_temp_root; trap cleanup_temp EXIT; recovery_process_snapshot 41 container-cgroup container-ns "$2" "$3"',
      [ports, processes, proc]
    );
    const snapshot = JSON.parse(stdout);
    assert.equal(snapshot.containerProcessCount, 1);
    assert.equal(snapshot.proxyProcessCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('ignores scanner volatility but rejects stable recovery snapshot drift', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-drift-stable-')
  );
  const receiptRoot = join(directory, 'receipts');
  const bin = await testBin();
  const base = {
    surfaces: [
      { class: 'running-processes', sha256: 'scanner-a' },
      { class: 'systemd-definitions', sha256: 'stable-a' },
    ],
    dependencies: [
      { 'key-name': 'running-processes:1', value: 'scanner-a' },
      { 'key-name': 'stable:1', value: 'stable-a' },
    ],
    consumerCounts: [
      { surface: 'running-processes', matchCount: 1 },
      { surface: 'systemd-definitions', matchCount: 1 },
    ],
    consumerEvidence: [
      { surface: 'running-processes', classifiedPathSha256: 'scanner-a' },
      { surface: 'systemd-definitions', classifiedPathSha256: 'stable-a' },
    ],
    processes: {
      scannerAncestors: [{ pid: '10', startTime: '1' }],
      matchingProcesses: [],
    },
  };
  const snapshot = await snapshotFile(directory, base);
  try {
    const env = {
      RETIRE_OLLAMA_TEST_BIN: bin,
      RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
    };
    await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"',
      [snapshot, sourceSha],
      env
    );
    const dynamic = JSON.parse(JSON.stringify(base));
    dynamic.surfaces[0].sha256 = 'scanner-b';
    dynamic.dependencies[0].value = 'scanner-b';
    dynamic.consumerEvidence[0].classifiedPathSha256 = 'scanner-b';
    dynamic.processes.scannerAncestors[0].startTime = '2';
    await writeFile(snapshot, `${JSON.stringify(dynamic)}\n`);
    await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"',
      [snapshot, sourceSha],
      env
    );
    dynamic.surfaces[1].sha256 = 'stable-b';
    await writeFile(snapshot, `${JSON.stringify(dynamic)}\n`);
    await assert.rejects(
      shell(
        'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"',
        [snapshot, sourceSha],
        env
      ),
      (error) => error.code === 78 && /snapshot drift/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('keeps receipt publication temporaries on the receipt filesystem', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-receipt-fs-'));
  const receiptRoot = join(directory, 'receipts');
  const externalTmp = join(directory, 'external-tmp');
  const bin = await testBin();
  const snapshot = await snapshotFile(directory, {
    surfaces: [],
    dependencies: [],
    consumerCounts: [],
    consumerEvidence: [],
  });
  await Promise.all([
    mkdir(receiptRoot, { mode: 0o700 }),
    mkdir(externalTmp, { mode: 0o700 }),
  ]);
  try {
    const { stdout } = await shell(
      'ln() { source="$2"; target="$3"; [ "$(dirname "$source")" = "$(dirname "$target")" ] || { printf "cross-filesystem receipt publication\\n" >&2; return 91; }; /bin/ln -- "$source" "$target"; }; fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$5"; RETIRE_OLLAMA_TMPDIR="$4"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"',
      [snapshot, receiptRoot, externalTmp, sourceSha],
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
      }
    );
    assert.match(stdout, /^[0-9a-f]{64}\n$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});
