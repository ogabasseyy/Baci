import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
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
const containerId =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const prelude =
  'sha256sum() { /usr/bin/shasum -a 256 "$@"; }; stat() { if [ "$1" = -c ] && [ "$2" = %F ]; then [ -d "$3" ] && printf "directory\\n" || printf "regular file\\n"; else printf "1:2:81a4:10:501:20:644\\n"; fi; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

function scanCompose(root, bin) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
      'retire-ollama-compose-round9-test',
      script.pathname,
      root,
    ],
    bin
      ? {
          ...unprivileged,
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: bin,
          },
        }
      : undefined
  );
}

test('binds an immutable stopped Compose image configuration containing Ollama', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-image-consumer-'))
  );
  const bin = join(root, 'bin');
  const compose = join(root, 'compose.yaml');
  const imageId = `sha256:${'a'.repeat(64)}`;
  try {
    await mkdir(bin);
    await Promise.all([
      writeFile(compose, 'services:\n  app:\n    image: generic-local-image\n'),
      writeFile(
        join(bin, 'docker'),
        `#!/bin/sh
case "$*" in
  *'image inspect -f '*' generic-local-image') printf '%s\\n' '${imageId} ["OLLAMA_HOST=http://127.0.0.1:11434"] {} null [] []' ;;
  *) exit 64 ;;
esac
`
      ),
    ]);
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(bin, 0o755),
      chmod(root, 0o755),
    ]);
    const { stdout } = await scanCompose(root, bin);
    assert.match(stdout, new RegExp(`^compose-image:.*${imageId}`, 'm'));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('binds endpoint files below COPY dot and ADD subdirectory sources', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-directory-build-'))
  );
  const compose = join(root, 'compose.yaml');
  const dockerfile = join(root, 'Dockerfile');
  const topLevel = join(root, 'runtime.env');
  const nested = join(root, 'src', 'worker.env');
  try {
    await mkdir(join(root, 'src'));
    await Promise.all([
      writeFile(compose, 'services:\n  app:\n    build: .\n'),
      writeFile(dockerfile, 'FROM scratch\nCOPY . /app\nADD src/ /app/src/\n'),
      writeFile(topLevel, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
      writeFile(nested, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
    ]);
    const { stdout } = await scanCompose(root);
    assert.match(stdout, new RegExp(`\\|${topLevel}\\|`, 'm'));
    assert.match(stdout, new RegExp(`\\|${nested}\\|`, 'm'));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('binds an unloaded systemd wrapper with a valid failure prefix', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-prefixed-wrapper-'))
  );
  const root = join(directory, 'units');
  const unit = join(root, 'application.service');
  const wrapper = join(directory, 'application-worker');
  try {
    await mkdir(root);
    await Promise.all([
      writeFile(unit, `[Service]\nExecStart=-${wrapper}\n`),
      writeFile(wrapper, '#!/bin/sh\ncurl http://127.0.0.1:11434\n'),
    ]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}getent() { return 2; }; systemctl() { return 0; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
      'retire-ollama-prefixed-wrapper-test',
      script.pathname,
      root,
    ]);
    assert.match(stdout, new RegExp(`^${unit}\\|.*\\|${wrapper}\\|`, 'm'));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('finds a stopped generic container whose only dependency is a legacy link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-container-link-'));
  const bin = join(root, 'bin');
  try {
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
  *'inspect -f {{.Id}} '*'.HostConfig.Links'*' ${containerId}') printf '${containerId} /generic-api /bin/true [] [] {} null [] {} {} {} ["/ollama-loopback:ollama"] "bridge"\\n' ;;
  *'inspect -f {{.Id}} '*' ${containerId}') printf '${containerId} /generic-api /bin/true [] [] {} null [] {} {} {} [] "bridge"\\n' ;;
  *) exit 64 ;;
esac
`
    );
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(bin, 0o755),
      chmod(root, 0o755),
    ]);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all`,
        'retire-ollama-container-link-test',
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
    assert.match(stdout, /ollama-loopback:ollama/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('follows a trusted Debian Nginx sites-enabled symlink', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-nginx-enabled-link-'))
  );
  const enabled = join(root, 'sites-enabled');
  const available = join(root, 'sites-available');
  const main = join(root, 'nginx.conf');
  const target = join(available, 'store');
  try {
    await Promise.all([mkdir(enabled), mkdir(available)]);
    await Promise.all([
      writeFile(main, `include ${join(enabled, 'store')};\n`),
      writeFile(target, 'proxy_pass http://127.0.0.1:11434;\n'),
      symlink(target, join(enabled, 'store')),
    ]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); NGINX_ROOT="$2"; init_temp_root; trap cleanup_temp EXIT; scan_nginx_definitions`,
      'retire-ollama-nginx-enabled-link-test',
      script.pathname,
      root,
    ]);
    assert.match(stdout, new RegExp(`\\|${target}\\|`, 'm'));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
