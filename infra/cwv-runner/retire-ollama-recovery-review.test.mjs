import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
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
const sourceSha = 'b'.repeat(40);
async function sha256(file) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

function shellAt(pathname, command, args = [], env = {}, options = {}) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; [ -z "\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}" ] || RECOVERY_RECEIPT_ROOT="\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}"; ${command}`,
      'recovery-review-test',
      pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: '/sbin',
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...env,
      },
      ...options,
    }
  );
}

function shell(command, args = [], env = {}) {
  return shellAt(script.pathname, command, args, env);
}

function shellWithSyntheticProc(command, args = [], env = {}) {
  const options = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
  return shellAt(script.pathname, command, args, env, options);
}

async function receiptBin() {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-bin-'));
  await chmod(directory, 0o755);
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
    `#!/bin/sh\nif [ "$1" = -f ]; then [ "$2" = -- ] && p=$3 || p=$2; printf "%s\\n" "\${RETIRE_OLLAMA_TEST_REALPATH:-$p}"; else exec /usr/bin/readlink "$@"; fi\n`
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

test('derives the source identity from the sealed SHA directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-recovery-source-'));
  const sealed = join(root, 'source', sourceSha);
  try {
    await mkdir(sealed, { recursive: true });
    for (const name of [
      'retire-ollama.sh',
      'retire-ollama-recovery.sh',
      'retire-ollama-recovery-receipts.sh',
      'retire-ollama-consumers.sh',
      'retire-ollama-container-mounts.sh',
      'retire-ollama-running-container.sh',
      'retire-ollama-running-container-validation.sh',
      'retire-ollama-running-archive.sh',
      'retire-ollama-consumer-closure.sh',
      'retire-ollama-process-files.sh',
      'retire-ollama-cron-inventory.sh',
      'retire-ollama-at-quiescence.sh',
      'retire-ollama-temp-root.sh',
      'retire-ollama-image-filesystem.pl',
      'retire-ollama-projector-auth.sh',
    ]) {
      await copyFile(new URL(`./${name}`, import.meta.url), join(sealed, name));
    }
    const { stdout } = await shellAt(
      join(sealed, 'retire-ollama.sh'),
      'init_temp_root; trap cleanup_temp EXIT; recovery_source_digests; printf "%s:%s:%s:%s:%s:%s:%s\\n" "$RECOVERY_SOURCE_SHA" "$RECOVERY_RUNNING_ARCHIVE_SHA" "$RECOVERY_CONSUMER_CLOSURE_SHA" "$RECOVERY_CRON_INVENTORY_SHA" "$RECOVERY_AT_QUIESCENCE_SHA" "$RECOVERY_IMAGE_FILESYSTEM_SHA" "$RECOVERY_PROJECTOR_AUTH_SHA"'
    );
    assert.deepEqual(stdout.trim().split(':'), [
      sourceSha,
      await sha256(
        new URL('./retire-ollama-running-archive.sh', import.meta.url)
      ),
      await sha256(
        new URL('./retire-ollama-consumer-closure.sh', import.meta.url)
      ),
      await sha256(
        new URL('./retire-ollama-cron-inventory.sh', import.meta.url)
      ),
      await sha256(
        new URL('./retire-ollama-at-quiescence.sh', import.meta.url)
      ),
      await sha256(
        new URL('./retire-ollama-image-filesystem.pl', import.meta.url)
      ),
      await sha256(
        new URL('./retire-ollama-projector-auth.sh', import.meta.url)
      ),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('accepts the merged-usr executable alias only after canonical resolution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-recovery-alias-'));
  const bin = join(root, 'bin');
  const procRoot = join(root, 'proc');
  const proc = join(procRoot, '41');
  try {
    await mkdir(proc, { mode: 0o755, recursive: true });
    await mkdir(bin, { mode: 0o755 });
    await chmod(root, 0o755);
    await chmod(procRoot, 0o755);
    await chmod(bin, 0o755);
    await writeFile(
      join(bin, 'readlink'),
      '#!/bin/sh\ncase "$1" in -f) case "$3" in */missing/ollama) exit 1;; esac; printf "/usr/bin/ollama\\n";; --) printf "/bin/ollama\\n";; *) exit 1;; esac\n'
    );
    await writeFile(
      join(bin, 'sha256sum'),
      '#!/bin/sh\nprintf "%064d  %s\\n" 0 "$2"\n'
    );
    await writeFile(
      join(bin, 'stat'),
      '#!/bin/sh\nprintf "1:2:1000:1000:755\\n"\n'
    );
    await Promise.all(
      ['readlink', 'sha256sum', 'stat'].map((name) =>
        chmod(join(bin, name), 0o755)
      )
    );
    await symlink('/bin/ollama', join(proc, 'exe'));
    await writeFile(
      join(proc, 'stat'),
      `41 (ollama) ${Array.from({ length: 20 }, () => '1').join(' ')}\n`
    );
    await writeFile(join(proc, 'status'), 'Uid:\t1000\t1000\t1000\t1000\n');
    const { stdout } = await shellWithSyntheticProc(
      '[ "$RECOVERY_PROC_ROOT" = "$2" ] || exit 79; init_temp_root; trap cleanup_temp EXIT; recovery_process_executable 41 /bin/ollama ollama',
      [procRoot],
      { RETIRE_OLLAMA_PROC_ROOT: procRoot, RETIRE_OLLAMA_TEST_BIN: bin }
    );
    const executable = JSON.parse(stdout);
    assert.equal(executable.path, '/bin/ollama');
    assert.equal(executable.realPath, '/usr/bin/ollama');
    await assert.rejects(
      shellWithSyntheticProc(
        '[ "$RECOVERY_PROC_ROOT" = "$2" ] || exit 79; init_temp_root; trap cleanup_temp EXIT; recovery_process_executable 41 /missing/ollama ollama',
        [procRoot],
        { RETIRE_OLLAMA_PROC_ROOT: procRoot, RETIRE_OLLAMA_TEST_BIN: bin }
      ),
      (error) =>
        error.code === 78 && /expectation unresolved/.test(error.stderr)
    );
    await assert.rejects(
      shellWithSyntheticProc(
        '[ "$RECOVERY_PROC_ROOT" = "$2" ] || exit 79; init_temp_root; trap cleanup_temp EXIT; recovery_process_executable 41 /../../usr/bin/ollama ollama',
        [procRoot],
        { RETIRE_OLLAMA_PROC_ROOT: procRoot, RETIRE_OLLAMA_TEST_BIN: bin }
      ),
      (error) =>
        error.code === 78 && /expectation path unsafe/.test(error.stderr)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('requires the reviewed loopback tuple for the Docker proxy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-proxy-'));
  const ports = join(directory, 'ports.json');
  try {
    await writeFile(
      ports,
      '{"NetworkSettings":{"Ports":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]},"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}}}\n'
    );
    const { stdout } = await shell(
      'recovery_proxy_ports_ok "docker-proxy -proto tcp -host-ip 127.0.0.1 -host-port 11434 -container-ip 172.17.0.2 -container-port 11434" "$2" && printf loopback || printf public; recovery_proxy_ports_ok "docker-proxy -proto tcp -host-ip 0.0.0.0 -host-port 11434 -container-ip 172.17.0.2 -container-port 11434" "$2" && printf bad || printf rejected',
      [ports]
    );
    assert.deepEqual(stdout.trim().split('\n'), ['loopbackrejected']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses a changed scan snapshot for an existing receipt pair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-drift-'));
  const receiptRoot = join(directory, 'receipts');
  const snapshot = join(directory, 'snapshot.json');
  const bin = await receiptBin();
  await mkdir(receiptRoot, { mode: 0o700 });
  try {
    await writeFile(snapshot, '{"surfaces":[],"dependencies":[]}\n');
    const env = {
      RETIRE_OLLAMA_TEST_BIN: bin,
      RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
    };
    await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"',
      [snapshot, sourceSha],
      env
    );
    await writeFile(
      snapshot,
      '{"surfaces":[{"class":"changed"}],"dependencies":[]}\n'
    );
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

test('rejects a Docker transport error instead of recording container absence', async () => {
  await assert.rejects(
    shell(
      'recovery_docker() { printf "Cannot connect to Docker daemon\\n" >&2; return 1; }; init_temp_root; trap cleanup_temp EXIT; recovery_container_snapshot'
    ),
    (error) => error.code === 65 && /inspection failed/.test(error.stderr)
  );
});

test('rejects container executable paths that escape the container root', async () => {
  const inspected = JSON.stringify({
    Name: '/ollama-loopback',
    Id: 'b'.repeat(64),
    Image: `sha256:${'c'.repeat(64)}`,
    State: { Running: false, Pid: 0 },
    Path: '/../../usr/bin/ollama',
    Config: {},
    HostConfig: {},
    Mounts: [],
    NetworkSettings: { Networks: {} },
  });
  await assert.rejects(
    shell(
      `recovery_docker() { printf '%s\\n' '${inspected}'; }; init_temp_root; trap cleanup_temp EXIT; recovery_container_snapshot`
    ),
    (error) =>
      error.code === 65 &&
      /invalid recovery container snapshot/.test(error.stderr)
  );
});

test('keeps one process surface when the post-action container is absent', async () => {
  const source = await readFile(
    new URL('./retire-ollama-recovery.sh', import.meta.url),
    'utf8'
  );
  assert.match(
    source,
    /recovery_container_snapshot >"\$container"\n {2}recovery_collect_processes "\$processes"\n {2}case "\$\{RECOVERY_CONTAINER_STATE:-\}" in absent\|stopped\)/
  );
});
