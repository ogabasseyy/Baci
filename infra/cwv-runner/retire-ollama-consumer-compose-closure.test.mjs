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
const containerId = '0123456789abcdef'.repeat(4);
const prelude =
  'sha256sum() { /usr/bin/shasum -a 256 "$@"; }; stat() { printf "1:2:81a4:10:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

function assertBinding(output, definition, target) {
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

function scanCompose(root) {
  return execFileAsync('sh', [
    '-c',
    `${prelude}docker() { case "$*" in *'image inspect -f '*) printf 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa [] {} null [] []\\n' ;; *) return 64 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
    'retire-ollama-compose-closure-test',
    script.pathname,
    root,
  ]);
}

test('binds a valid flow-form Compose build mapping to its custom Dockerfile', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-flow-build-'))
  );
  const compose = join(root, 'compose.yaml');
  const dockerfile = join(root, 'Dockerfile.ollama');
  try {
    await Promise.all([
      writeFile(
        compose,
        'services:\n  app:\n    build: { context: ., dockerfile: Dockerfile.ollama }\n'
      ),
      writeFile(dockerfile, 'RUN curl http://ollama:11434\n'),
    ]);
    assertBinding((await scanCompose(root)).stdout, compose, dockerfile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('accepts source-less Docker tmpfs mounts but rejects a tmpfs carrying host source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-container-tmpfs-'));
  const bin = join(root, 'bin');
  const mounts = join(root, 'mounts.json');
  try {
    await mkdir(bin);
    await Promise.all([
      writeFile(
        mounts,
        '[{"Type":"tmpfs","Source":"","Destination":"/run/cache","Mode":"","RW":true,"Propagation":"","Name":null}]\n'
      ),
      writeFile(
        join(bin, 'docker'),
        `#!/bin/sh
case "$*" in
  *' ps -a '*) printf '${containerId}\\n' ;;
  *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;;
  *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;;
  *' cp ${containerId}:/bin/true '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;;
  *'inspect -f {{.Id}} '* ) printf '${containerId} /generic-api /bin/true [] [] [] '; cat '${mounts}'; printf ' {} {} {} [] "bridge"\\n' ;;
  *'inspect -f {{json .Mounts}} ${containerId}') cat '${mounts}' ;;
esac
`
      ),
    ]);
    await Promise.all([chmod(join(bin, 'docker'), 0o755), chmod(root, 0o755)]);
    const scan = () =>
      execFileAsync(
        'sh',
        [
          '-c',
          `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all`,
          'retire-ollama-container-tmpfs-test',
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
    assert.equal((await scan()).stdout, '');
    await writeFile(
      mounts,
      '[{"Type":"tmpfs","Source":"/host","Destination":"/run/cache","Mode":"","RW":true,"Propagation":"","Name":null}]\n'
    );
    await assert.rejects(scan(), (error) => error.code === 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binds stopped Compose config and secret file sources inside their project root', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-external-files-'))
  );
  const compose = join(root, 'compose.yaml');
  const config = join(root, 'config', 'runner.conf');
  const secret = join(root, 'secrets', 'runner.token');
  try {
    await Promise.all([
      mkdir(join(root, 'config')),
      mkdir(join(root, 'secrets')),
    ]);
    await Promise.all([
      writeFile(
        compose,
        'services:\n  stopped:\n    image: busybox\nconfigs:\n  runner:\n    file: ./config/runner.conf\nsecrets:\n  token:\n    file: ./secrets/runner.token\n'
      ),
      writeFile(config, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
      writeFile(secret, 'OLLAMA_TOKEN=example\n'),
    ]);
    const { stdout } = await scanCompose(root);
    assertBinding(stdout, compose, config);
    assertBinding(stdout, compose, secret);
    await writeFile(
      compose,
      'configs:\n  runner:\n    file: ../outside.conf\n'
    );
    await assert.rejects(scanCompose(root), (error) => error.code === 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binds a stopped Compose service local bind-mount source and confines it to the project', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-bind-source-'))
  );
  const compose = join(root, 'compose.yaml');
  const source = join(root, 'application.conf');
  const relative = join(root, 'config', 'application.conf');
  try {
    await mkdir(join(root, 'config'));
    await Promise.all([
      writeFile(
        compose,
        'services:\n  stopped:\n    image: busybox\n    volumes:\n      - ./application.conf:/app/application.conf:ro\n'
      ),
      writeFile(source, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
      writeFile(relative, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
    ]);
    assertBinding((await scanCompose(root)).stdout, compose, source);
    await writeFile(
      compose,
      'services:\n  stopped:\n    volumes:\n      - config/application.conf:/app/application.conf\n'
    );
    assertBinding((await scanCompose(root)).stdout, compose, relative);
    await writeFile(
      compose,
      'services:\n  stopped:\n    volumes:\n      - data:/app/application.conf\n'
    );
    await assert.rejects(scanCompose(root), (error) => error.code === 2);
    await writeFile(
      compose,
      'services:\n  stopped:\n    image: busybox\n    volumes:\n      - type: bind\n        source: ./application.conf\n        target: /app/application.conf\n'
    );
    assertBinding((await scanCompose(root)).stdout, compose, source);
    await writeFile(
      compose,
      'services:\n  stopped:\n    volumes:\n      - source: ./application.conf\n        type: bind\n        target: /app/application.conf\n'
    );
    await assert.rejects(scanCompose(root), (error) => error.code === 2);
    await writeFile(
      compose,
      'services:\n  stopped:\n    volumes:\n      - "./application.conf:/app/application.conf"\n'
    );
    await assert.rejects(scanCompose(root), (error) => error.code === 2);
    await writeFile(
      compose,
      `services:\n  stopped:\n    volumes:\n      - \${CONFIG_FILE}:/app/application.conf\n`
    );
    await assert.rejects(scanCompose(root), (error) => error.code === 2);
    await writeFile(
      compose,
      'services:\n  stopped:\n    volumes:\n      - { type: bind, source: ./application.conf, target: /app/application.conf }\n'
    );
    await assert.rejects(scanCompose(root), (error) => error.code === 2);
    await writeFile(
      compose,
      'services:\n  stopped:\n    volumes: ["./application.conf:/app/application.conf"]\n'
    );
    await assert.rejects(scanCompose(root), (error) => error.code === 2);
    await writeFile(
      compose,
      'services:\n  stopped:\n    volumes:\n      - ../outside.conf:/app/application.conf\n'
    );
    await assert.rejects(scanCompose(root), (error) => error.code === 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preserves the parent Compose definition while recursing through sibling extends files', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-extends-siblings-'))
  );
  const compose = join(root, 'compose.yaml');
  const first = join(root, 'fragments', 'first.yml');
  const second = join(root, 'second.yml');
  const shadow = join(root, 'fragments', 'second.yml');
  try {
    await mkdir(join(root, 'fragments'));
    await Promise.all([
      writeFile(
        compose,
        'services:\n  first:\n    extends:\n      file: ./fragments/first.yml\n      service: first\n  second:\n    extends:\n      file: ./second.yml\n      service: second\n'
      ),
      writeFile(first, 'services:\n  first:\n    image: busybox\n'),
      writeFile(
        second,
        'services:\n  second:\n    environment:\n      OLLAMA_HOST: http://127.0.0.1:11434\n'
      ),
      writeFile(shadow, 'services:\n  second:\n    image: busybox\n'),
    ]);
    assert.match(
      (await scanCompose(root)).stdout,
      new RegExp(`^${second}\\|`, 'm')
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('finds a stopped generic container whose only Ollama endpoint is a label', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-container-label-'));
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
  *'inspect -f {{.Id}} '*) printf '${containerId} /generic-api /bin/true [] [] {"traefik.http.services.api.loadbalancer.server.url":"http://127.0.0.1:11434"} null [] {} {} {} [] "bridge"\\n' ;;
  *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;;
esac
`
    );
    await Promise.all([chmod(join(bin, 'docker'), 0o755), chmod(root, 0o755)]);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all`,
        'retire-ollama-container-label-test',
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
    assert.match(stdout, /traefik.*11434/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
