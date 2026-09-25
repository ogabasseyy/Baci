import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const containerId =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const prelude =
  'sha256sum() { /usr/bin/shasum -a 256 "$@"; }; stat() { printf "1:2:81a4:10:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

async function withDocker(networkMode, callback, { changing = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'baci-container-network-mode-'));
  const bin = join(root, 'bin');
  const calls = join(root, 'calls');
  await mkdir(bin);
  await writeFile(
    join(bin, 'docker'),
    `#!/bin/sh
case "$*" in
  *' ps -a '*) printf '${containerId}\\n' ;;
  *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;;
  *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;;
  *' cp ${containerId}:/bin/true '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;;
  *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;;
  *'inspect -f {{.Id}} '*'.HostConfig.NetworkMode'*' ${containerId}')
    mode='${networkMode}'
    if [ '${changing ? '1' : '0'}' = 1 ]; then
      count=0; [ ! -f '${calls}' ] || count=$(cat '${calls}'); count=$((count + 1)); printf '%s\\n' "$count" >'${calls}'
      [ $((count % 2)) -eq 1 ] || mode=bridge
    fi
    printf '${containerId} /generic-api /bin/true [] [] {} null [] {} {} {} [] "%s"\\n' "$mode" ;;
  *'inspect -f {{.Id}} '*' ${containerId}')
    printf '${containerId} /generic-api /bin/true [] [] {} null [] {} {} {} []\\n' ;;
  *) exit 64 ;;
esac
`
  );
  await Promise.all([
    chmod(join(bin, 'docker'), 0o755),
    chmod(bin, 0o755),
    chmod(root, 0o755),
  ]);
  try {
    await callback(bin);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function scanContainers(bin) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all`,
      'retire-ollama-container-network-mode-test',
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
}

test('finds a stopped generic container sharing the Ollama container network namespace', async () => {
  await withDocker('container:ollama-loopback', async (bin) => {
    const { stdout } = await scanContainers(bin);
    assert.match(stdout, /"container:ollama-loopback"/);
  });
});

test('refuses malformed container network modes', async () => {
  await withDocker('container:$' + '{OLLAMA_CONTAINER}', async (bin) => {
    await assert.rejects(scanContainers(bin), (error) => error.code === 2);
  });
});

test('refuses a container network mode that changes between snapshots', async () => {
  await withDocker(
    'container:ollama-loopback',
    async (bin) => {
      await assert.rejects(scanContainers(bin), (error) => error.code === 2);
    },
    { changing: true }
  );
});
