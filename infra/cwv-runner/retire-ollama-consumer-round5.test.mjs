import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const containerId =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const prelude =
  'RETIRE_OLLAMA_TEST_BIN=/usr/bin; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; stat() { printf "1:2:81a4:10:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

async function directory(prefix) {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

function scanCompose(root) {
  return execFileAsync('sh', [
    '-c',
    `${prelude}docker() { case "$*" in *'image inspect -f '*) printf 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa [] {} null [] []\\n' ;; *) return 64 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
    'retire-ollama-compose-round5-test',
    script.pathname,
    root,
  ]);
}

function hasBinding(output, definition, target) {
  return output
    .trim()
    .split('\n')
    .some(
      (line) =>
        line.startsWith(`${definition}|`) && line.includes(`|${target}|`)
    );
}

test('accepts an empty Compose env_file sequence', async () => {
  const root = await directory('baci-compose-empty-env-file-');
  try {
    await writeFile(
      join(root, 'compose.yaml'),
      'services:\n  app:\n    env_file: []\n'
    );
    assert.equal((await scanCompose(root)).stdout, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('follows local Compose extends files and project interpolation environments', async () => {
  const root = await directory('baci-compose-extends-dotenv-');
  const compose = join(root, 'compose.yaml');
  const fragments = join(root, 'fragments');
  const common = join(fragments, 'common.yml');
  const environment = join(root, '.env');
  try {
    await mkdir(fragments);
    await Promise.all([
      writeFile(
        compose,
        'services:\n  app:\n    extends: { file: ./fragments/common.yml, service: common }\n'
      ),
      writeFile(
        common,
        `services:\n  common:\n    environment:\n      MODEL_URL: \${MODEL_URL}\n`
      ),
      writeFile(environment, 'MODEL_URL=http://127.0.0.1:11434\n'),
    ]);
    const { stdout } = await scanCompose(root);
    assert.ok(hasBinding(stdout, common, environment));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('follows one local extends file per service', async () => {
  const root = await directory('baci-compose-multiple-extends-');
  const compose = join(root, 'compose.yaml');
  const first = join(root, 'first.yml');
  const second = join(root, 'second.yml');
  try {
    await Promise.all([
      writeFile(
        compose,
        'services:\n  first:\n    extends:\n      file: ./first.yml\n      service: first\n  second:\n    extends:\n      file: ./second.yml\n      service: second\n'
      ),
      writeFile(first, 'services:\n  first:\n    image: busybox\n'),
      writeFile(
        second,
        'services:\n  second:\n    environment:\n      OLLAMA_HOST: http://127.0.0.1:11434\n'
      ),
    ]);
    const { stdout } = await scanCompose(root);
    assert.match(
      stdout,
      new RegExp(`^${second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`, 'm')
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binds unbraced Compose interpolation but ignores escaped dollars', async () => {
  const root = await directory('baci-compose-unbraced-interpolation-');
  const compose = join(root, 'compose.yaml');
  const environment = join(root, '.env');
  try {
    await Promise.all([
      writeFile(
        compose,
        'services:\n  app:\n    environment:\n      MODEL_URL: $MODEL_URL\n      LITERAL: $$MODEL_URL\n'
      ),
      writeFile(environment, 'MODEL_URL=http://127.0.0.1:11434\n'),
    ]);
    assert.ok(
      hasBinding((await scanCompose(root)).stdout, compose, environment)
    );
    await writeFile(
      compose,
      'services:\n  app:\n    environment:\n      LITERAL: $$MODEL_URL\n'
    );
    assert.equal((await scanCompose(root)).stdout, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed when the Compose traversal fails', async () => {
  const root = await directory('baci-compose-find-failure-');
  try {
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${prelude}. "$1"; find() { return 1; }; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
        'retire-ollama-compose-find-failure-test',
        script.pathname,
        root,
      ]),
      { code: 2 }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('finds an inline Nginx include in a block token stream', async () => {
  const root = await directory('baci-nginx-inline-include-');
  const nginx = join(root, 'nginx');
  const definition = join(nginx, 'nginx.conf');
  const included = join(root, 'upstream.conf');
  try {
    await mkdir(nginx);
    await Promise.all([
      writeFile(definition, `http { include ${included}; }\n`),
      writeFile(included, 'proxy_pass http://127.0.0.1:11434;\n'),
    ]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); NGINX_ROOT="$2"; init_temp_root; trap cleanup_temp EXIT; scan_nginx_definitions`,
      'retire-ollama-nginx-inline-test',
      script.pathname,
      nginx,
    ]);
    assert.ok(hasBinding(stdout, definition, included));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('joins continued static EnvironmentFile directives', async () => {
  const root = await directory('baci-systemd-continued-environment-');
  const unit = join(root, 'worker.service');
  const firstEnvironment = join(root, 'base.env');
  const environment = join(root, 'application.env');
  try {
    await Promise.all([
      writeFile(
        unit,
        `EnvironmentFile=${firstEnvironment} \\\n ${environment}\n`
      ),
      writeFile(firstEnvironment, 'MODEL_PROVIDER=external\n'),
      writeFile(environment, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
    ]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}getent() { return 2; }; systemctl() { return 0; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
      'retire-ollama-systemd-continuation-test',
      script.pathname,
      root,
    ]);
    assert.ok(hasBinding(stdout, unit, environment));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('records health checks and every runtime execution phase', async () => {
  const root = await directory('baci-runtime-phases-');
  try {
    const command = `${prelude}docker() { case "$*" in *' ps -a '*) printf '${containerId}\\n';; *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n';; *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n';; *' cp ${containerId}:/bin/true '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination";; *'inspect -f {{.Id}} '*) case "$*" in *'Healthcheck'*) printf '${containerId} /generic-api /bin/true [] [] {"Test":["CMD-SHELL","curl http://127.0.0.1:11434"]} [] {} {} {} [] "bridge"\\n';; *) printf '${containerId} /generic-api /bin/true [] [] [] {} {} {} [] "bridge"\\n';; esac;; *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n';; esac; }; systemctl() { case "$1" in list-units) printf 'transient.service loaded inactive dead transient\\n';; show) for property in RootDirectory RootImage Environment EnvironmentFiles LoadCredential LoadCredentialEncrypted StandardInput ExecCondition ExecStartPre ExecStart ExecStartPost ExecReload ExecStop ExecStopPost; do case " $* " in *" --property=$property "*) :;; *) return 2;; esac; done; printf 'RootDirectory=\\nRootImage=\\nEnvironment=\\nEnvironmentFiles=\\nLoadCredential=\\nLoadCredentialEncrypted=\\nStandardInput=null\\nExecCondition={}\\nExecStartPre={ path=/usr/bin/curl ; argv[]=/usr/bin/curl http://127.0.0.1:11434 ; }\\nExecStart={}\\nExecStartPost={}\\nExecReload={}\\nExecStop={}\\nExecStopPost={}\\n';; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all; scan_systemd_runtime_consumers`;
    const { stdout } = await execFileAsync('sh', [
      '-c',
      command,
      'retire-ollama-health-phase-test',
      script.pathname,
    ]);
    assert.match(stdout, new RegExp(`^${containerId} .*11434`, 'm'));
    assert.match(stdout, /^transient\.service:/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
