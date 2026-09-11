import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const containerId = 'a'.repeat(64);
const secretFixture = 'fixture-secret-do-not-leak-8f7c2a';

async function runContainerScan(mode) {
  const root = await mkdtemp(
    join(tmpdir(), 'baci-ollama-container-diagnostics-')
  );
  const bindSource = join(root, 'bind');
  const failureState = join(root, 'first-bind-failure');
  await mkdir(bindSource);
  await writeFile(
    join(bindSource, 'application.conf'),
    'endpoint=http://127.0.0.1:11434\n'
  );
  const canonicalBindSource = await realpath(bindSource);

  const shell = String.raw`
docker() {
  case "$*" in
    *' ps -a '*) printf '%s\n' "$RETIRE_TEST_CONTAINER_ID" ;;
    *'inspect -f {{.Name}} '* ) printf '/generic-api\n' ;;
    *'inspect -f {{json .State.Running}} '* ) printf 'false\n' ;;
    *'inspect -f {{json .Mounts}} '* ) printf '[{"Type":"bind","Source":"%s","Destination":"/etc/application","Driver":"","Mode":"","RW":true,"Propagation":"rprivate","Name":""}]\n' "$RETIRE_TEST_BIND_SOURCE" ;;
    *) return 2 ;;
  esac
}
. "$1"
SCRIPT_DIR=$(dirname "$1")
RETIRE_OLLAMA_TMPDIR="$2"
load_consumer_scanners
container_configuration() {
  printf '%s /generic-api /bin/true [] [] "" {} null [] {} {} {} [] "bridge"\n' "$RETIRE_TEST_CONTAINER_ID"
}
container_configuration_network_mode() { :; }
stopped_container_validate() { :; }
container_bind_directory_consumers() {
  if [ "$RETIRE_TEST_FIND_MODE" = persistent ] || [ ! -e "$RETIRE_TEST_FIND_STATE" ]; then
    [ -e "$RETIRE_TEST_FIND_STATE" ] || : >"$RETIRE_TEST_FIND_STATE"
    if [ "$RETIRE_TEST_FIND_MODE" = persistent ]; then
      printf '%s\n' "$RETIRE_TEST_SECRET" >&2
    fi
    return 2
  fi
}
container_argument_consumers() { :; }
container_option_argument_consumers() { :; }
container_environment_consumers() { :; }
container_healthcheck_consumers() { :; }
load_temp_root_helper
temp_root_required_bytes() { printf '1\n'; }
init_temp_root
trap cleanup_temp EXIT
CANONICAL_DOCKER_SOCKET=/tmp/docker.sock
scan_container_rows all
`;

  try {
    return await execFileAsync(
      'sh',
      [
        '-c',
        shell,
        'retire-ollama-container-diagnostics-test',
        script.pathname,
        root,
      ],
      {
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
          RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
          RETIRE_TEST_BIND_SOURCE: canonicalBindSource,
          RETIRE_TEST_CONTAINER_ID: containerId,
          RETIRE_TEST_FIND_MODE: mode,
          RETIRE_TEST_FIND_STATE: failureState,
          RETIRE_TEST_SECRET: secretFixture,
        },
      }
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test('reports one sanitized bind-directory diagnostic after a persistent retry failure', async () => {
  await assert.rejects(runContainerScan('persistent'), (error) => {
    assert.equal(error.code, 2);
    assert.equal(error.stdout, '');
    assert.equal(
      error.stderr,
      `container-scan-failure id=${containerId} phase=bind-directory status=2\n`
    );
    assert.equal(error.stderr.includes(secretFixture), false);
    return true;
  });
});

test('emits no diagnostic when the first bind-directory attempt succeeds on retry', async () => {
  const result = await runContainerScan('transient');

  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('preserves a stopped-container scanner failure status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-stopped-scanner-status-'));
  const shell = String.raw`
. "$1"
SCRIPT_DIR=$(dirname "$1")
RETIRE_OLLAMA_TMPDIR="$2"
load_consumer_scanners
load_temp_root_helper
temp_root_required_bytes() { printf '1\n'; }
init_temp_root
trap cleanup_temp EXIT
CANONICAL_DOCKER_SOCKET=/tmp/docker.sock
docker() { case "$*" in *'inspect -f {{.Name}}'*) printf '/generic-api\n';; *'inspect -f {{json .State.Running}}'*) printf 'false\n';; *) return 2;; esac; }
container_configuration() { printf '%s /generic-api /bin/true [] [] "" {} null [] {} {} {} [] "bridge"\n' "$RETIRE_TEST_CONTAINER_ID"; }
container_configuration_network_mode() { :; }
stopped_container_validate() { :; }
container_bind_mount_consumers() { return 7; }
container_argument_consumers() { :; }
container_option_argument_consumers() { :; }
container_environment_consumers() { :; }
container_healthcheck_consumers() { :; }
container_scan_bindings "$RETIRE_TEST_CONTAINER_ID" /generic-api "$RETIRE_TEST_CONTAINER_ID /generic-api /bin/true [] [] \"\" {} null [] {} {} {} [] \"bridge\""
`;
  try {
    await assert.rejects(
      execFileAsync('sh', ['-c', shell, 'stopped-status-test', script.pathname, root], {
        env: { ...process.env, RETIRE_OLLAMA_TEST_BIN: '/usr/bin', RETIRE_OLLAMA_TEST_FSTYPE: 'apfs', RETIRE_TEST_CONTAINER_ID: containerId },
      }),
      (error) => error.code === 7
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
