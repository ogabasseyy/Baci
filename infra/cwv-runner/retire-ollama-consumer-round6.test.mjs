import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const containerId =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const prelude =
  'stat() { printf "1:2:81a4:10:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};

function scanCompose(root) {
  return execFileAsync('sh', [
    '-c',
    `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
    'retire-ollama-compose-round6-test',
    script.pathname,
    root,
  ]);
}

test('scans an unloaded user unit in the user-control load path', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-user-control-'))
  );
  const system = join(root, 'system');
  const home = join(root, 'home');
  const control = join(home, '.config', 'systemd', 'user.control');
  const unit = join(control, 'stopped.service');
  try {
    await Promise.all([mkdir(system), mkdir(control, { recursive: true })]);
    await writeFile(
      unit,
      '[Service]\nEnvironment=OLLAMA_HOST=http://127.0.0.1:11434\n'
    );
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}home=$3; getent() { printf 'bassey:x:1001:1001::%s:/bin/sh\\n' "$home"; }; systemctl() { return 0; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; load_consumer_scanners; roots=$(temp_path); systemd_user_roots "1001:$home" >"$roots"; grep -Fqx "$home/.config/systemd/user.control" "$roots" || exit 2; systemd_user_roots() { [ "$1" = "1001:$home" ] || return 2; printf '%s\\n' "$home/.config/systemd/user.control"; }; systemd_user_manager_available() { return 1; }; scan_systemd_consumers`,
      'retire-ollama-user-control-test',
      script.pathname,
      system,
      home,
    ]);
    assert.match(
      stdout,
      new RegExp(`^${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`, 'm')
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('discovers a Compose model below the former depth cutoff', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-deep-'))
  );
  const deep = join(root, 'one', 'two', 'three', 'four', 'five', 'six');
  const compose = join(deep, 'compose.yaml');
  try {
    await mkdir(deep, { recursive: true });
    await writeFile(
      compose,
      'services:\n  app:\n    environment:\n      OLLAMA_HOST: http://127.0.0.1:11434\n'
    );
    assert.match(
      (await scanCompose(root)).stdout,
      new RegExp(`^${compose.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`, 'm')
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('traverses a top-level Compose include model', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-include-'))
  );
  const compose = join(root, 'compose.yaml');
  const included = join(root, 'models', 'application.yaml');
  try {
    await mkdir(join(root, 'models'));
    await Promise.all([
      writeFile(compose, 'include:\n  - path: ./models/application.yaml\n'),
      writeFile(
        included,
        'services:\n  app:\n    environment:\n      OLLAMA_HOST: http://127.0.0.1:11434\n'
      ),
    ]);
    assert.match(
      (await scanCompose(root)).stdout,
      new RegExp(`^${included.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`, 'm')
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed when a stopped container changes from the reviewed name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-container-rename-'));
  const bin = join(root, 'bin');
  const state = join(root, 'name-state');
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
case "$*" in
  *' ps -a '*) printf '${containerId}\\n' ;;
  *'inspect -f {{.Name}} ${containerId}') count=$(cat '${state}' 2>/dev/null || printf 0); count=$((count + 1)); printf '%s' "$count" >'${state}'; [ "$count" -eq 1 ] && printf '/ollama-loopback\\n' || printf '/generic-api\\n' ;;
  *'inspect -f {{.Id}} '*) printf '${containerId} /ollama-loopback /bin/true [] [] {} null [] {} {} {} [] "bridge"\\n' ;;
  *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;;
esac
`
    );
    await Promise.all([chmod(join(bin, 'docker'), 0o755), chmod(root, 0o777)]);
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all`,
          'retire-ollama-container-rename-test',
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
    await rm(root, { recursive: true, force: true });
  }
});
