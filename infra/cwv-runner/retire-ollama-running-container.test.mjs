import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { installDockerStub } from './running-container-fixture.mjs';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const imageId = `sha256:${'b'.repeat(64)}`;
async function runFixture(command) {
  const directory = await mkdtemp(join(tmpdir(), 'baci-running-container-'));
  try {
    const bin = join(directory, 'bin');
    await mkdir(bin);
    const socketFixturePrelude = `test() { if [ "$1" = -S ]; then case "$2" in /run/docker.sock|/var/run/docker.sock) return 0 ;; *) return 1 ;; esac; fi; /usr/bin/test "$@"; }; stat() { case "$*" in *"%u:%a"*"/run/docker.sock"|*"%u:%a"*"/var/run/docker.sock") printf '0:660\\n' ;; *"/run/docker.sock"|*"/var/run/docker.sock") printf '1:2:14000:0:999:660\\n' ;; *) /usr/bin/stat "$@" ;; esac; }; readlink() { if [ "$1" = -f ]; then path=$2; [ "$path" = -- ] && path=$3; case "$path" in /run/docker.sock|/var/run/docker.sock) printf '/run/docker.sock\\n' ;; *) /usr/bin/readlink "$@" ;; esac; else /usr/bin/readlink "$@"; fi; };`;
    const shellCommand = `. "$1"; SCRIPT_DIR=$(dirname "$1"); export RETIRE_OLLAMA_TMPDIR="$2"; RETIRE_OLLAMA_TEST_BIN="$3"; RETIRE_OLLAMA_TEST_FSTYPE=apfs; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; ${socketFixturePrelude} ${injectProjectionStub(command)}`;
    await installDockerStub(bin, shellCommand, { wrapArchives: true });
    const { stdout } = await execFileAsync('sh', [
      '-c',
      shellCommand,
      script.pathname.replace(/\.sh$/, '-test.sh'),
      script.pathname,
      directory,
      bin,
    ]);
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function injectProjectionStub(command) {
  const token = 'load_consumer_scanners;';
  assert.equal(
    command.split(token).length - 1,
    1,
    'fixture must load consumer scanners exactly once before stub injection'
  );
  return command.replace(
    token,
    `${token} running_container_image_matches_merged() { consumer_matches "$1"; };`
  );
}

const metadataDocker = `docker() { case "$*" in *'inspect -f {{.Name}} generic-api'*) printf '%s\\n' '/generic-api';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';; *'inspect -f {{.Image}} generic-api'*) printf '%s\\n' '${imageId}';; *'inspect -f {{json .Path}} generic-api'*) printf '%s\\n' '"/docker-entrypoint"';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *'inspect -f {{json .Args}} generic-api'*) printf '%s\\n' '["--model","llama3.2:latest"]';; *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["NODE_VERSION=22.14.0","MODEL=llama3.2:latest","DOCKER_SOCK=/var/run/docker.sock"]';; *'inspect -f {{json (index .Config "Healthcheck")}} generic-api'*) printf '%s\\n' '{"Test":["CMD-SHELL","curl -fsS http://127.0.0.1:8080/health"]}';; *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[{"Type":"bind","Source":"/var/run/docker.sock","Destination":"/var/run/docker.sock"}]';; *'container export generic-api'*) printf '%s\\n' 'clean live filesystem';; *' cp '*) printf 'unexpected docker cp\\n' >&2; return 91;;`;
test('emits digest-bound evidence when the immutable running image contains Ollama markers', async () => {
  const output = await runFixture(
    `${metadataDocker} *'image save ${imageId}'*) printf '%s\\n' 'filesystem endpoint=http://127.0.0.1:11434';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
  );
  assert.match(
    output,
    /^running-container-image:[0-9a-f]{64}\|[0-9a-f]{64}\|[0-9a-f]{64}$/m
  );
  assert.doesNotMatch(output, /filesystem|11434/);
});
test('emits digest-bound evidence for Ollama markers in the live writable layer', async () => {
  const liveFilesystem = metadataDocker.replace(
    "printf '%s\\n' 'clean live filesystem'",
    "printf '%s\\n' 'runtime.conf endpoint=http://127.0.0.1:11434'"
  );
  const output = await runFixture(
    `${liveFilesystem} *'image save ${imageId}'*) printf '%s\\n' 'clean image filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
  );
  assert.match(
    output,
    /^running-container-filesystem:[0-9a-f]{64}\|[0-9a-f]{64}\|[0-9a-f]{64}$/m
  );
  assert.doesNotMatch(output, /runtime\.conf|11434/);
});
test('fails closed when live writable-layer exports drift', async () => {
  const driftingFilesystem = metadataDocker.replace(
    "*'container export generic-api'*) printf '%s\\n' 'clean live filesystem';;",
    '*\'container export generic-api\'*) count=$(cat "$RETIRE_OLLAMA_TMPDIR/export-count" 2>/dev/null || printf 0); count=$((count + 1)); printf \'%s\' "$count" >"$RETIRE_OLLAMA_TMPDIR/export-count"; printf \'filesystem-%s\' "$count";;'
  );
  await assert.rejects(
    runFixture(
      `${driftingFilesystem} *'image save ${imageId}'*) printf '%s\\n' 'clean image filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
    ),
    (error) => error.code === 2
  );
});
test('accepts a safe absolute running-container argument', async () => {
  const absoluteArgument = metadataDocker.replace(
    '["--model","llama3.2:latest"]',
    '["/etc/application.conf"]'
  );
  const output = await runFixture(
    `${absoluteArgument} *'image save ${imageId}'*) printf '%s\\n' 'filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
  );
  assert.equal(output, '');
});
test('accepts a safe bare running-container entrypoint used by Docker images', async () => {
  const bareEntrypoint = metadataDocker.replace(
    '"/docker-entrypoint"',
    '"docker-entrypoint.sh"'
  );
  const output = await runFixture(
    `${bareEntrypoint} *'image save ${imageId}'*) printf '%s\\n' 'filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
  );
  assert.equal(output, '');
});
test('accepts Docker root as a running-container working directory', async () => {
  const rootWorkingDirectory = metadataDocker.replace(
    "printf '%s\\n' '\"\"'",
    "printf '%s\\n' '\"/\"'"
  );
  const output = await runFixture(
    `${rootWorkingDirectory} *'image save ${imageId}'*) printf '%s\\n' 'filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
  );
  assert.equal(output, '');
});
test('serializes an absent Docker healthcheck as null', async () => {
  const output = await runFixture(
    `docker() { case "$*" in *'index .Config "Healthcheck"'*) printf '%s\\n' 'generic-api /generic-api /bin/true [] [] "" {} null {} {} {} [] "bridge"';; *'{{json .Mounts}}'*) printf '%s\\n' '[]';; *) return 2;; esac; }; load_consumer_scanners; container_configuration generic-api`
  );
  assert.equal(
    output,
    'generic-api /generic-api /bin/true [] [] "" {} null {} {} {} [] [] "bridge"\n'
  );
});
test('accepts a running container with no healthcheck property', async () => {
  const absentHealthcheck = metadataDocker.replace(
    '{"Test":["CMD-SHELL","curl -fsS http://127.0.0.1:8080/health"]}',
    'null'
  );
  const output = await runFixture(
    `${absentHealthcheck} *'image save ${imageId}'*) printf '%s\\n' 'filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
  );
  assert.equal(output, '');
});
test('exports one immutable image twice for two containers sharing its ID', async () => {
  const sharedImageDocker = metadataDocker.replace(
    'docker() { case "$*" in',
    'docker() { case "$*" in *generic-two*) set -- $(printf \'%s\\n\' "$*" | /usr/bin/sed \'s/generic-two/generic-api/g\');; esac; case "$*" in'
  );
  const output = await runFixture(
    `save_count="$2/save-count"; ${sharedImageDocker} *'image save ${imageId}'*) count=$(cat "$save_count" 2>/dev/null || printf 0); count=$((count + 1)); printf '%s' "$count" >"$save_count"; printf '%s\\n' 'filesystem endpoint=http://127.0.0.1:11434';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-one'; running_container_validate generic-two /generic-api 'stable-two'; [ "$(cat "$save_count")" -eq 2 ]`
  );
  assert.equal(output.match(/^running-container-image:/gm)?.length, 2);
});
test('fails closed when immutable running-image saves drift', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-container-drift-')
  );
  try {
    const bin = join(directory, 'bin');
    await mkdir(bin);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; RETIRE_OLLAMA_TEST_BIN="$3"; RETIRE_OLLAMA_TEST_FSTYPE=apfs; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; ${metadataDocker} *'image save ${imageId}'*) if [ ! -e '${directory}/seen' ]; then : >'${directory}/seen'; printf first; else printf second; fi;; *) return 2;; esac; ${injectProjectionStub("load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'")}`,
        'running-container-drift-test',
        script.pathname,
        directory,
        bin,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('fails closed when immutable running-image save fails', async () => {
  await assert.rejects(
    runFixture(
      `save_marker="$2/save-seen"; ${metadataDocker} *'image save ${imageId}'*) if [ ! -e "$save_marker" ]; then : >"$save_marker"; printf '%s' first; else return 73; fi;; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
    ),
    (error) => error.code === 2
  );
});
test('fails closed when the retained running-image archive exceeds the byte limit', async () => {
  await assert.rejects(
    runFixture(
      `${metadataDocker} *'image save ${imageId}'*) printf '%s' '0123456789';; *) return 2;; esac; }; load_consumer_scanners; RUNNING_CONTAINER_IMAGE_MAX_BYTES=8; running_container_validate generic-api /generic-api 'stable-config'`
    ),
    (error) => error.code === 2
  );
});
test('uses a separate bounded allowance for large live container filesystems', async () => {
  const largeFilesystem = metadataDocker.replace(
    "printf '%s\\n' 'clean live filesystem'",
    "printf '%s' '0123456789'"
  );
  const output = await runFixture(
    `${largeFilesystem} *'image save ${imageId}'*) printf '%s' 'image';; *) return 2;; esac; }; load_consumer_scanners; RUNNING_CONTAINER_IMAGE_MAX_BYTES=8; RUNNING_CONTAINER_FILESYSTEM_MAX_BYTES=65536; running_container_validate generic-api /generic-api 'stable-config'`
  );
  assert.equal(output, '');
});
test('still rejects a live container filesystem above its own byte limit', async () => {
  const largeFilesystem = metadataDocker.replace(
    "printf '%s\\n' 'clean live filesystem'",
    "printf '%s' '0123456789'"
  );
  await assert.rejects(
    runFixture(
      `${largeFilesystem} *'image save ${imageId}'*) printf '%s' 'image';; *) return 2;; esac; }; load_consumer_scanners; RUNNING_CONTAINER_IMAGE_MAX_BYTES=16; RUNNING_CONTAINER_FILESYSTEM_MAX_BYTES=8; running_container_validate generic-api /generic-api 'stable-config'`
    ),
    (error) => error.code === 2
  );
});
test('uses a separate deadline for large live container filesystem exports', async () => {
  const output = await runFixture(
    `${metadataDocker} *'image save ${imageId}'*) printf '%s' 'image';; *) return 2;; esac; }; load_consumer_scanners; clock="$2/filesystem-clock"; running_container_now() { if [ -n "\${running_filesystem_save_fifo:-}" ]; then if [ -e "$clock" ]; then printf '2\\n'; else : >"$clock"; printf '0\\n'; fi; else printf '0\\n'; fi; }; RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS=1; RUNNING_CONTAINER_FILESYSTEM_SAVE_TIMEOUT_SECONDS=3; running_container_validate generic-api /generic-api 'stable-config'`
  );
  assert.equal(output, '');
});
test('fails closed when a running-image export hangs past the watchdog', async () => {
  await assert.rejects(
    runFixture(
      `${metadataDocker} *'image save ${imageId}'*) exec sleep 120;; *) return 2;; esac; }; load_consumer_scanners; RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS=1; running_container_validate generic-api /generic-api 'stable-config'`
    ),
    (error) => error.code === 2
  );
});

test('keeps enforcing the deadline after archive output is complete', async () => {
  await assert.rejects(
    runFixture(
      'docker() { return 2; }; load_consumer_scanners; status="$2/status"; clock="$2/clock"; printf \'0\\n\' >"$status"; sleep 3 & sleeper=$!; running_container_now() { if [ -e "$clock" ]; then printf \'3\\n\'; else : >"$clock"; printf \'1\\n\'; fi; }; running_container_wait_group 2 "$sleeper" -- "$status"'
    ),
    (error) => error.code === 124
  );
});

test('shares one deadline across both immutable running-image saves', async () => {
  await assert.rejects(
    runFixture(
      `${metadataDocker} *'image save ${imageId}'*) printf '%s\\n' 'filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_now() { [ -p "\${running_image_hash_fifo:-}" ] && printf '%s\\n' 3 || printf '%s\\n' 1; }; RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS=2; running_container_validate generic-api /generic-api 'stable-config'`
    ),
    (error) => error.code === 2
  );
});

test('rejects a running container with a noncanonical DOCKER_SOCK scalar', async () => {
  const noncanonical = metadataDocker.replace(
    '["NODE_VERSION=22.14.0","MODEL=llama3.2:latest","DOCKER_SOCK=/var/run/docker.sock"]',
    '["NODE_VERSION=22.14.0","MODEL=llama3.2:latest","DOCKER_SOCK=/tmp/docker.sock"]'
  );
  await assert.rejects(
    runFixture(
      `${noncanonical} *'image save ${imageId}'*) printf '%s\\n' 'filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
    ),
    (error) => error.code === 2
  );
});

test('rejects duplicate canonical DOCKER_SOCK entries', async () => {
  const duplicate = metadataDocker.replace(
    '["NODE_VERSION=22.14.0","MODEL=llama3.2:latest","DOCKER_SOCK=/var/run/docker.sock"]',
    '["NODE_VERSION=22.14.0","MODEL=llama3.2:latest","DOCKER_SOCK=/var/run/docker.sock","DOCKER_SOCK=/run/docker.sock"]'
  );
  await assert.rejects(
    runFixture(
      `${duplicate} *'image save ${imageId}'*) printf '%s\\n' 'filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
    ),
    (error) => error.code === 2
  );
});

test('rejects newline-bearing running-container environment strings', async () => {
  const newlineEnv = metadataDocker.replace(
    '["NODE_VERSION=22.14.0","MODEL=llama3.2:latest","DOCKER_SOCK=/var/run/docker.sock"]',
    '["DOCKER_PG_LLVM_DEPS=llvm21-dev\\nclang21"]'
  );
  await assert.rejects(
    runFixture(
      `${newlineEnv} *'image save ${imageId}'*) printf '%s\\n' 'filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
    ),
    (error) => error.code === 2
  );
});

test('accepts PostgreSQL LLVM package lists with space and tab separators', async () => {
  const postgresEnv = metadataDocker.replace(
    '["NODE_VERSION=22.14.0","MODEL=llama3.2:latest","DOCKER_SOCK=/var/run/docker.sock"]',
    '["DOCKER_PG_LLVM_DEPS=llvm19-dev \\t\\tclang19"]'
  );
  const output = await runFixture(
    `${postgresEnv} *'image save ${imageId}'*) printf '%s\\n' 'clean image filesystem';; *) return 2;; esac; }; load_consumer_scanners; running_container_validate generic-api /generic-api 'stable-config'`
  );
  assert.equal(output, '');
});

// The stub flips on read six: one initial read, two validator reads, and two
// validator rechecks must remain true before the final binding comparison.
test('fails closed when a running container stops before the final stable-state reads', async () => {
  const stateFileSetup = 'state_file="$2/state"; ';
  const transitioning = metadataDocker.replace(
    "*'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';;",
    '*\'inspect -f {{json .State.Running}} generic-api\'*) count=$(cat "$state_file" 2>/dev/null || printf 0); count=$((count + 1)); printf \'%s\' "$count" >"$state_file"; [ "$count" -le 5 ] && printf \'%s\\n\' true || printf \'%s\\n\' false;;'
  );
  await assert.rejects(
    runFixture(
      `${stateFileSetup}${transitioning} *'image save ${imageId}'*) printf '%s\\n' 'filesystem endpoint=http://127.0.0.1:11434';; *) return 2;; esac; }; load_consumer_scanners; container_configuration() { printf '%s\\n' stable-config; }; container_bind_mount_consumers() { :; }; container_scan_bindings generic-api /generic-api stable-config`
    ),
    (error) => error.code === 2
  );
});
