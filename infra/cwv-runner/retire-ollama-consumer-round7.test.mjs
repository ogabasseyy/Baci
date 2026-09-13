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
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const prelude =
  'sha256sum() { if [ -x /usr/bin/sha256sum ]; then /usr/bin/sha256sum "$@"; elif [ -x /bin/sha256sum ]; then /bin/sha256sum "$@"; else /usr/bin/shasum -a 256 "$@"; fi; }; stat() { if [ "$1" = -c ] && [ "$2" = %F ]; then [ -d "$3" ] && printf "directory\\n" || printf "regular file\\n"; elif [ "$1" = -c ] && [ "$2" = %s ]; then /usr/bin/wc -c <"$3" | /usr/bin/tr -d " "; else printf "1:2:81a4:10:501:20:644\\n"; fi; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

function binding(output, definition, target) {
  assert.ok(
    output
      .trim()
      .split('\n')
      .some(
        (line) =>
          line.startsWith(`${definition}|`) && line.includes(`|${target}|`)
      ),
    `missing binding from ${definition} to ${target}`
  );
}

test('inspects an explicitly named Compose volume without a container', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-named-volume-'))
  );
  const bin = join(root, 'bin');
  const compose = join(root, 'compose.yaml');
  const volume = join(root, 'application-config');
  try {
    await Promise.all([mkdir(bin), mkdir(volume)]);
    await Promise.all([
      writeFile(
        compose,
        'services:\n  app:\n    volumes:\n      - app-config:/app/config\nvolumes:\n  app-config:\n    name: application-config\n'
      ),
      writeFile(
        join(volume, 'runtime.env'),
        'OLLAMA_HOST=http://127.0.0.1:11434\n'
      ),
      writeFile(
        join(bin, 'docker'),
        `#!/bin/sh
case "$*" in
  *'volume inspect -f {{json .}} application-config'*) printf '%s\\n' '{"Name":"application-config","Driver":"local","Mountpoint":"${volume}","Scope":"local"}' ;;
  *) return 64 ;;
esac
`
      ),
    ]);
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(bin, 0o755),
      chmod(root, 0o755),
    ]);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
        'retire-ollama-compose-volume-test',
        script.pathname,
        root,
      ],
      {
        ...unprivileged,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          RETIRE_OLLAMA_TEST_BIN: bin,
        },
      }
    );
    assert.match(stdout, /^container-volume:/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inspects a named Compose volume with four-space YAML indentation', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-named-volume-indent-'))
  );
  const bin = join(root, 'bin');
  const compose = join(root, 'compose.yaml');
  const volume = join(root, 'application-config');
  try {
    await Promise.all([mkdir(bin), mkdir(volume)]);
    await Promise.all([
      writeFile(
        compose,
        'services:\n    app:\n        volumes:\n            - app-config:/app/config\nvolumes:\n    app-config:\n        name: "application-config"\n'
      ),
      writeFile(
        join(volume, 'runtime.env'),
        'OLLAMA_HOST=http://127.0.0.1:11434\n'
      ),
      writeFile(
        join(bin, 'docker'),
        `#!/bin/sh
case "$*" in
  *'volume inspect -f {{json .}} application-config'*) printf '%s\\n' '{"Name":"application-config","Driver":"local","Mountpoint":"${volume}","Scope":"local"}' ;;
  *) return 64 ;;
esac
`
      ),
    ]);
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(bin, 0o755),
      chmod(root, 0o755),
    ]);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
        'retire-ollama-compose-volume-indent-test',
        script.pathname,
        root,
      ],
      {
        ...unprivileged,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          RETIRE_OLLAMA_TEST_BIN: bin,
        },
      }
    );
    assert.match(stdout, /^container-volume:/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binds a stopped systemd wrapper script containing the endpoint', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-wrapper-'))
  );
  const unit = join(root, 'application.service');
  const wrapper = join(root, 'application-worker');
  try {
    await Promise.all([
      writeFile(unit, `[Service]\nExecStart=${wrapper}\n`),
      writeFile(wrapper, '#!/bin/sh\ncurl http://127.0.0.1:11434\n'),
    ]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}getent() { return 2; }; systemctl() { return 0; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
      'retire-ollama-systemd-wrapper-test',
      script.pathname,
      root,
    ]);
    binding(stdout, unit, wrapper);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binds a stopped systemd interpreter script and refuses shell evaluation', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-interpreter-'))
  );
  const interpreted = join(root, 'interpreted.service');
  const wrapper = join(root, 'application-worker');
  try {
    await Promise.all([
      writeFile(interpreted, `[Service]\nExecStart=/bin/sh ${wrapper}\n`),
      writeFile(wrapper, '#!/bin/sh\ncurl http://127.0.0.1:11434\n'),
    ]);
    const scan = () =>
      execFileAsync('sh', [
        '-c',
        `${prelude}getent() { return 2; }; systemctl() { return 0; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
        'retire-ollama-systemd-interpreter-test',
        script.pathname,
        root,
      ]);
    binding((await scan()).stdout, interpreted, wrapper);
    await writeFile(
      interpreted,
      `[Service]\nExecStart=/bin/sh -c ${wrapper}\n`
    );
    await assert.rejects(scan(), (error) => error.code === 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scans unloaded user units for a second local account', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-other-user-'))
  );
  const system = join(root, 'system');
  const owner = join(root, 'bassey');
  const alice = join(root, 'alice');
  const ownerUnit = join(
    owner,
    '.config',
    'systemd',
    'user',
    'owner-application.service'
  );
  const aliceUnit = join(
    alice,
    '.config',
    'systemd',
    'user',
    'application.service'
  );
  try {
    await Promise.all([
      mkdir(system),
      mkdir(join(owner, '.config', 'systemd', 'user'), { recursive: true }),
      mkdir(join(alice, '.config', 'systemd', 'user'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        ownerUnit,
        '[Service]\nEnvironment=OLLAMA_HOST=http://127.0.0.1:11434\n'
      ),
      writeFile(
        aliceUnit,
        '[Service]\nEnvironment=OLLAMA_HOST=http://127.0.0.1:11434\n'
      ),
    ]);
    const { stderr, stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}owner=$3; alice=$4; getent() { [ "$1" = passwd ] || return 2; case "\${2:-}" in '') printf 'bassey:x:1001:1001::%s:/bin/sh\\nalice:x:999:999::%s:/usr/sbin/nologin\\n' "$owner" "$alice";; *) return 2;; esac; }; systemctl() { return 0; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; systemd_user_roots() { home=\${1#*:}; printf '%s\\n' "$home/.config/systemd/user"; }; systemd_user_manager_available() { printf '%s\\n' "$1" >&2; return 1; }; SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
      'retire-ollama-systemd-other-user-test',
      script.pathname,
      system,
      owner,
      alice,
    ]);
    assert.match(
      stderr,
      new RegExp(`^1001:${owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm')
    );
    assert.match(
      stderr,
      new RegExp(`^999:${alice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm')
    );
    assert.match(
      stdout,
      new RegExp(`^${ownerUnit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`, 'm')
    );
    assert.match(
      stdout,
      new RegExp(`^${aliceUnit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`, 'm')
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
