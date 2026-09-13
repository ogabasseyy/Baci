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
  'stat() { for last do :; done; case "$*" in *"-c %F"*) [ -d "$last" ] && printf "directory\\n" || printf "regular file\\n" ;; *"-c %d:%i:%f:%s:%u:%g:%a"*) printf "1:2:81a4:10:501:20:644\\n" ;; *"-c %d"*) printf "1\\n" ;; *"-c %s"*) wc -c <"$last" | tr -d " " ;; *) printf "1:2:81a4:10:501:20:644\\n" ;; esac; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

function assertBoundPair(output, definition, target) {
  const fields = output.trim().split('|');
  assert.equal(fields[0], definition);
  assert.match(fields[1], /^[0-9a-f]{64}$/);
  assert.match(fields[2], /^[0-9a-f]{64}$/);
  assert.equal(fields[3], target);
  assert.match(fields[4], /^[0-9a-f]{64}$/);
  assert.match(fields[5], /^[0-9a-f]{64}$/);
}

test('accepts an unmatched safe Nginx include wildcard but rejects parent traversal', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-nginx-wildcard-'))
  );
  const nginx = join(directory, 'nginx');
  const definition = join(nginx, 'site.conf');
  try {
    await mkdir(nginx);
    await writeFile(definition, `include ${nginx}/optional/*.conf;\n`);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); NGINX_ROOT="$2"; init_temp_root; trap cleanup_temp EXIT; scan_nginx_definitions; printf stable`,
      'retire-ollama-nginx-wildcard-test',
      script.pathname,
      nginx,
    ]);
    assert.equal(stdout, 'stable');
    await writeFile(definition, `include ${nginx}/../unsafe/*.conf;\n`);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); NGINX_ROOT="$2"; init_temp_root; trap cleanup_temp EXIT; scan_nginx_definitions`,
        'retire-ollama-nginx-wildcard-traversal-test',
        script.pathname,
        nginx,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('canonicalizes and fingerprints an absolute Compose env_file', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-absolute-'))
  );
  const composeRoot = join(directory, 'compose');
  const compose = join(composeRoot, 'compose.yaml');
  const environment = join(directory, 'runtime.env');
  try {
    await mkdir(composeRoot);
    await writeFile(
      compose,
      `services:\n  app:\n    env_file: ${environment}\n`
    );
    await writeFile(environment, 'OLLAMA_HOST=http://127.0.0.1:11434\n');
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
      'retire-ollama-compose-absolute-test',
      script.pathname,
      composeRoot,
    ]);
    assertBoundPair(stdout, compose, environment);
    const alias = join(directory, 'runtime-link.env');
    await symlink(environment, alias);
    await writeFile(compose, `services:\n  app:\n    env_file: ${alias}\n`);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
        'retire-ollama-compose-absolute-link-test',
        script.pathname,
        composeRoot,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('requests non-ellipsized names from systemctl list-units', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-systemctl-full-'));
  const inventory = join(directory, 'units');
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        'systemctl() { printf "%s\\n" "$*"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; load_consumer_scanners; systemd_runtime_inventory "$2"; cat "$2"',
        'retire-ollama-systemctl-full-test',
        script.pathname,
        inventory,
      ],
      {
        ...unprivileged,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
          RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        },
      }
    );
    assert.match(stdout, /^list-units .*--full/m);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not exempt a generic container merely because another inspect field names Ollama', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-container-name-'));
  const bin = join(directory, 'bin');
  const environment = join(directory, 'runtime.env');
  try {
    await mkdir(bin);
    await writeFile(environment, 'OLLAMA_HOST=http://127.0.0.1:11434\n');
    const source = await realpath(environment);
    await writeFile(
      join(bin, 'docker'),
      `#!/bin/sh
case "$*" in
  *' ps -a '*) printf '${containerId}\\n' ;;
  *' inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;;
  *' inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;;
  *' cp ${containerId}:/usr/bin/ollama-loopback '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;;
  *' inspect -f {{.Id}} {{.Name}} {{.Path}} {{json .Args}} {{json .Config.Env}} {{json .Config.WorkingDir}} {{json .Config.Labels}} {{json (index .Config "Healthcheck")}} {{json .HostConfig.PortBindings}} {{json .NetworkSettings.Ports}} {{json .NetworkSettings.Networks}} {{json .HostConfig.Links}} {{json .HostConfig.NetworkMode}} ${containerId}') printf '${containerId} /generic-api /usr/bin/ollama-loopback [] [] "" {} null {} {} {} [] "bridge"\\n' ;;
  *'{{json .Mounts}}'*) printf '[{"Type":"bind","Source":"${source}","Destination":"/app/runtime.env"}]\\n' ;;
esac
`
    );
    await Promise.all([
      chmod(join(bin, 'docker'), 0o755),
      chmod(directory, 0o755),
    ]);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `${prelude}sha256sum() { /usr/bin/shasum -a 256 "$@"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all`,
        'retire-ollama-container-name-test',
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
      new RegExp(`container-bind-mount:${containerId}:/app/runtime\\.env\\|`)
    );
    assert.match(
      stdout,
      new RegExp(`${containerId} /generic-api /usr/bin/ollama-loopback`)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
