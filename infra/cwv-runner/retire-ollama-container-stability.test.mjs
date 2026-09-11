import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
import { createSourceArchive } from './source-archive.mjs';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const firstId = '1111111111111111'.repeat(4);
const secondId = '2222222222222222'.repeat(4);
const containerId = '0123456789abcdef'.repeat(4);

test('re-enumerates stopped containers added after the initial inventory and inspects image and writable layers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-container-stability-'));
  const bin = join(directory, 'bin');
  const state = join(directory, 'state');
  const log = join(directory, 'docker.log');
  const archive = join(directory, 'container.tar');
  try {
    await mkdir(bin);
    await writeFile(
      archive,
      createSourceArchive([
        {
          bytes: Buffer.from('OLLAMA_HOST=http://127.0.0.1:11434\n'),
          mode: '100644',
          path: 'etc/runtime.conf',
        },
      ])
    );
    await writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
case "$*" in
  *'ps -a '*)
    if [ -e '${state}' ]; then printf '${firstId}\\n${secondId}\\n'; else : >'${state}'; printf '${firstId}\\n'; fi ;;
  *'{{.Id}}'*${firstId}*) printf '${firstId} /first /bin/true [] [] "" {} null [] {} {} {} [] "bridge"\\n' ;;
  *'{{.Id}}'*${secondId}*) printf '${secondId} /second /bin/true [] ["OLLAMA_HOST=http://127.0.0.1:11434"] "" {} null [] {} {} {} [] "bridge"\\n' ;;
  *'{{.Name}}'*${firstId}*) printf '/first\\n' ;;
  *'{{.Name}}'*${secondId}*) printf '/second\\n' ;;
  *'{{.Image}}'*) printf 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n' ;;
  *'{{json .Config.Env}}'*${firstId}*) printf '[]\\n' ;;
  *'{{json .Config.Env}}'*${secondId}*) printf '["OLLAMA_HOST=http://127.0.0.1:11434"]\\n' ;;
  *'{{json .Config.WorkingDir}}'*) printf '""\\n' ;;
  *'{{json .State.Running}}'*) printf 'false\\n' ;;
  *' cp ${firstId}:/bin/true '*|*' cp ${secondId}:/bin/true '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;;
  *'image save '*|*'container export '*) /usr/bin/cat '${archive}' ;;
  *'{{json .Mounts}}'*) printf '[]\\n' ;;
esac
printf '%s\\n' "$*" >>'${log}'
`
    );
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(archive, 0o644),
      chmod(directory, 0o777),
    ]);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        'set -x; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; stat() { printf "1:2:81a4:17:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); load_temp_root_helper; temp_root_required_bytes() { printf 1; }; init_temp_root; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all',
        'retire-ollama-container-stability-test',
        script.pathname,
      ],
      {
        ...unprivileged,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: bin,
        },
      }
    );
    assert.match(
      stdout,
      new RegExp(`${secondId} /second .*OLLAMA_HOST`),
      await readFile(log, 'utf8')
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('accepts a stable mount set returned in alternating orders', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-container-mount-order-')
  );
  const bin = join(directory, 'bin');
  const mountState = join(directory, 'mount-state');
  const runningState = join(directory, 'running-state');
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
mounts_a='[{"Type":"bind","Name":"","Source":"/run/docker.sock","Destination":"/run/docker.sock","Driver":"","Mode":"rw","RW":true,"Propagation":"rprivate"},{"Type":"tmpfs","Name":"","Source":"","Destination":"/tmp/a","Driver":"","Mode":"","RW":true,"Propagation":""}]'
mounts_b='[{"Type":"tmpfs","Name":"","Source":"","Destination":"/tmp/a","Driver":"","Mode":"","RW":true,"Propagation":""},{"Type":"bind","Name":"","Source":"/run/docker.sock","Destination":"/run/docker.sock","Driver":"","Mode":"rw","RW":true,"Propagation":"rprivate"}]'
case "$*" in
  *'ps -a '*) printf '${containerId}\n' ;;
  *'{{.Id}}'*) printf '${containerId} /generic-api /bin/true [] ["DOCKER_SOCK=/run/docker.sock"] "" {} null [] {} {} {} [] "bridge"\n' ;;
  *'{{.Name}}'*) printf '/generic-api\n' ;;
  *'{{json .State.Running}}'*) if [ -e '${runningState}' ]; then printf 'true\n'; else printf 'false\n'; fi ;;
  *'[{{json .State.StartedAt}},{{json .State.Pid}},{{json .RestartCount}}]'*) printf '["2026-01-01T00:00:00Z",123,0]\n' ;;
  *'{{json .Config.Env}}'*) printf '["DOCKER_SOCK=/run/docker.sock"]\n' ;;
  *'{{json .Config.WorkingDir}}'*) printf '""\n' ;;
  *'{{json .Mounts}}'*) count=$(cat '${mountState}' 2>/dev/null || printf 0); count=$((count + 1)); printf '%s' "$count" >'${mountState}'; if [ $((count % 2)) -eq 1 ]; then printf '%s\n' "$mounts_a"; else printf '%s\n' "$mounts_b"; fi ;;
  *' cp ${containerId}:/bin/true '*) for destination do :; done; printf '#!/bin/sh\nexit 0\n' >"$destination" ;;
esac
`
    );
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(directory, 0o777),
    ]);
    const scan = () =>
      execFileAsync(
        'sh',
        [
          '-c',
          'sha256sum_path=$(command -v sha256sum 2>/dev/null || command -v shasum 2>/dev/null) || exit 127; case "$sha256sum_path" in *shasum) sha256sum() { "$sha256sum_path" -a 256 "$@"; } ;; *) sha256sum() { "$sha256sum_path" "$@"; } ;; esac; stat() { case "$*" in *"%u:%a"*"/run/docker.sock"|*"%u:%a"*"/var/run/docker.sock") printf "0:660\\n" ;; *"/run/docker.sock"|*"/var/run/docker.sock") printf "1:2:14000:0:999:660\\n" ;; *) printf "1:2:81a4:17:501:20:644\\n" ;; esac; }; test() { if [ "$1" = -S ]; then case "$2" in /run/docker.sock|/var/run/docker.sock) return 0 ;; *) return 1 ;; esac; fi; /usr/bin/test "$@"; }; readlink() { if [ "$1" = -f ]; then path=$2; [ "$path" = -- ] && path=$3; if [ "$path" = /run/docker.sock ] || [ "$path" = /var/run/docker.sock ]; then printf "/run/docker.sock\\n"; else /usr/bin/readlink "$@"; fi; else /usr/bin/readlink "$@"; fi; }; findmnt() { printf "/ fixture apfs ro\\n"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); load_temp_root_helper; temp_root_required_bytes() { printf 1; }; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; scan_container_rows all',
          'retire-ollama-container-mount-order-test',
          script.pathname,
        ],
        {
          ...unprivileged,
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: bin,
          },
        }
      );
    const { stdout } = await scan();
    assert.match(stdout, /^container-docker-socket:[0-9a-f]{64}:/m);
    await writeFile(runningState, 'true');
    await assert.rejects(scan(), (error) => {
      assert.equal(error.code, 2);
      assert.equal(
        error.stderr,
        `container-scan-failure id=${containerId} phase=tmpfs-mount status=2\n`
      );
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed after bounded container inventory churn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-container-churn-'));
  const bin = join(directory, 'bin');
  const state = join(directory, 'state');
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
last=''
for argument do last=$argument; done
case "$*" in
  *'ps -a '*)
    count=$(cat '${state}' 2>/dev/null || printf 0)
    count=$((count + 1))
    [ "$count" -lt 7 ] || exit 79
    printf '%s' "$count" >'${state}'
    /usr/bin/awk -v count="$count" 'BEGIN { for (item = 1; item <= count; item++) printf "%064d\\n", item }' ;;
  *'{{.Id}}'*) printf '%s /%s /bin/true [] [] [] {} {} {} [] "bridge"\\n' "$last" "$last" ;;
  *'{{.Name}}'*) printf '/%s\\n' "$last" ;;
  *'{{json .Mounts}}'*) printf '[]\\n' ;;
esac
`
    );
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(directory, 0o777),
    ]);
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          '. "$1"; SCRIPT_DIR=$(dirname "$1"); temp_root_required_bytes() { printf 1; }; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all',
          'retire-ollama-container-churn-test',
          script.pathname,
        ],
        {
          ...unprivileged,
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: bin,
          },
        }
      ),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
