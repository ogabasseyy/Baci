import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const containerId =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const prelude =
  'RETIRE_OLLAMA_TEST_BIN=/usr/bin; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; stat() { printf "1:2:81a4:10:0:0:600\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

test('binds a stopped container configuration embedded in an option', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-option-path-'))
  );
  try {
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}docker() { case "$*" in *' ps -a '*) printf '${containerId}\\n' ;; *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;; *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;; *'inspect -f {{json .Args}} ${containerId}') printf '["--","/opt/application-worker","-c=/etc/application.conf"]\\n' ;; *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;; *'inspect -f {{.Id}} '*) printf '${containerId} /generic-api /usr/bin/tini ["--","/opt/application-worker","-c=/etc/application.conf"] [] {} null [] {} {} {} [] "bridge"\\n' ;; *' cp ${containerId}:/usr/bin/tini '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;; *' cp ${containerId}:/opt/application-worker '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;; *' cp ${containerId}:/etc/application.conf '*) for destination do :; done; printf 'endpoint=http://127.0.0.1:11434\\n' >"$destination" ;; *) return 2 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; CONTAINER=ollama-loopback; scan_container_rows all`,
      'retire-ollama-container-option-path-test',
      script.pathname,
      directory,
    ]);
    assert.match(
      stdout,
      new RegExp(`container-argument:${containerId}:/etc/application\\.conf`)
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('binds a Compose-only image filesystem containing the endpoint', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-image-filesystem-'))
  );
  const compose = join(directory, 'compose.yaml');
  const imageId = `sha256:${'a'.repeat(64)}`;
  try {
    await writeFile(
      compose,
      'services:\n  app:\n    image: generic-local-image\n'
    );
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}docker() { case "$*" in *'image inspect -f '*' generic-local-image') printf '${imageId} []\\n' ;; *'image save '*'sha256:'*) printf 'filesystem endpoint=http://127.0.0.1:11434\\n' ;; *) return 2 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; CANONICAL_DOCKER_SOCKET=/run/docker.sock; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
      'retire-ollama-compose-image-filesystem-test',
      script.pathname,
      directory,
    ]);
    assert.match(stdout, /^compose-image-filesystem:/m);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed on a variable-bearing Dockerfile RUN step', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-dockerfile-run-variable-'))
  );
  try {
    await Promise.all([
      writeFile(
        join(directory, 'compose.yaml'),
        'services:\n  app:\n    build: .\n'
      ),
      writeFile(
        join(directory, 'Dockerfile'),
        'FROM scratch\nARG PORT_A=11\nARG PORT_B=434\nRUN printf "http://127.0.0.1:$' +
          '{PORT_A}$' +
          '{PORT_B}\\n" > /application.conf\n'
      ),
    ]);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
        'retire-ollama-dockerfile-run-variable-test',
        script.pathname,
        directory,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed when Dockerfile ENV synthesizes an endpoint from ARG values', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-dockerfile-env-variable-'))
  );
  try {
    await Promise.all([
      writeFile(
        join(directory, 'compose.yaml'),
        'services:\n  app:\n    build: .\n'
      ),
      writeFile(
        join(directory, 'Dockerfile'),
        'FROM scratch\nARG PORT_A=11\nARG PORT_B=434\nENV ENDPOINT=http://127.0.0.1:$' +
          '{PORT_A}$' +
          '{PORT_B}\n'
      ),
    ]);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
        'retire-ollama-dockerfile-env-variable-test',
        script.pathname,
        directory,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
