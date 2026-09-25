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
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-container-mount-recheck-')
  );
  try {
    const bin = join(directory, 'bin');
    await mkdir(bin);
    const socketFixturePrelude = `test() { if [ "$1" = -S ]; then case "$2" in /run/docker.sock|/var/run/docker.sock) return 0 ;; *) return 1 ;; esac; fi; /usr/bin/test "$@"; }; stat() { case "$*" in *"%u:%a"*"/run/docker.sock"|*"%u:%a"*"/var/run/docker.sock") printf '0:660\\n' ;; *"/run/docker.sock"|*"/var/run/docker.sock") printf '1:2:14000:0:999:660\\n' ;; *) /usr/bin/stat "$@" ;; esac; }; readlink() { if [ "$1" = -f ]; then path=$2; [ "$path" = -- ] && path=$3; case "$path" in /run/docker.sock|/var/run/docker.sock) printf '/run/docker.sock\\n' ;; *) /usr/bin/readlink "$@" ;; esac; else /usr/bin/readlink "$@"; fi; };`;
    const shellCommand = `. "$1"; SCRIPT_DIR=$(dirname "$1"); export RETIRE_OLLAMA_TMPDIR="$2"; RETIRE_OLLAMA_TEST_BIN="$3"; RETIRE_OLLAMA_TEST_FSTYPE=apfs; load_temp_root_helper; temp_root_required_bytes() { printf '1\\n'; }; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; ${socketFixturePrelude} ${injectProjectionStub(command)}`;
    await installDockerStub(bin, shellCommand);
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

const metadataDocker = `docker() { case "$*" in *'inspect -f {{.Name}} generic-api'*) printf '%s\\n' '/generic-api';; *'inspect -f [{{json .State.StartedAt}},{{json .State.Pid}},{{json .RestartCount}}] generic-api'*) printf '%s\\n' '["2026-08-29T00:00:00Z",42,0]';; *'inspect -f {{json .State.Running}} generic-api'*) printf '%s\\n' 'true';; *'inspect -f {{.Image}} generic-api'*) printf '%s\\n' '${imageId}';; *'inspect -f {{json .Path}} generic-api'*) printf '%s\\n' '"/docker-entrypoint"';; *'inspect -f {{json .Config.WorkingDir}} generic-api'*) printf '%s\\n' '""';; *'inspect -f {{json .Args}} generic-api'*) printf '%s\\n' '["--model","llama3.2:latest"]';; *'inspect -f {{json .Config.Env}} generic-api'*) printf '%s\\n' '["NODE_VERSION=22.14.0","MODEL=llama3.2:latest"]';; *'inspect -f {{json (index .Config "Healthcheck")}} generic-api'*) printf '%s\\n' '{"Test":["CMD-SHELL","curl -fsS http://127.0.0.1:8080/health"]}';; *'inspect -f {{json .Mounts}} generic-api'*) printf '%s\\n' '[{"Type":"bind","Source":"/var/run/docker.sock","Destination":"/var/run/docker.sock"}]';; *'container export generic-api'*) printf '%s\\n' 'clean live filesystem';; *'cp '*) printf 'unexpected docker cp\\n' >&2; return 91;; *'image save ${imageId}'*) printf '%s\\n' 'clean image filesystem';; *) return 2;; esac; }`;

test('rechecks bind and volume content after the live filesystem export', async () => {
  const output = await runFixture(
    `export_seen="$2/export-seen"; ${metadataDocker}; load_consumer_scanners; sha() { printf '%064d\\n' 0; }; running_container_archive_save_bounded() { printf '%s\\n' archive >"$3"; if [ "$1" = container ]; then : >"$export_seen"; fi; }; running_container_archive_hash_stream() { printf '%064d\\n' 0; }; container_configuration() { printf '%s\\n' stable-config; }; container_bind_mount_consumers() { if [ -e "$export_seen" ]; then printf '%s\\n' 'container-bind-mount:generic-api:/etc/application|new-ollama-endpoint'; fi; }; container_scan_bindings generic-api /generic-api stable-config`
  );
  assert.match(
    output,
    /^container-bind-mount:generic-api:\/etc\/application\|new-ollama-endpoint$/m
  );
});

test('rejects a running container that restarts after filesystem export', async () => {
  const restartingDocker = metadataDocker.replace(
    "printf '%s\\n' '[\"2026-08-29T00:00:00Z\",42,0]'",
    "if [ -e \"$export_seen\" ]; then printf '%s\\n' '[\"2026-08-29T00:01:00Z\",84,1]'; else printf '%s\\n' '[\"2026-08-29T00:00:00Z\",42,0]'; fi"
  );
  await assert.rejects(
    runFixture(
      `export_seen="$2/export-seen"; ${restartingDocker}; load_consumer_scanners; sha() { printf '%064d\\n' 0; }; running_container_archive_save_bounded() { printf '%s\\n' archive >"$3"; }; running_container_archive_hash_stream() { if [ "$1" = container ]; then : >"$export_seen"; fi; printf '%064d\\n' 0; }; container_configuration() { printf '%s\\n' stable-config; }; container_bind_mount_consumers() { :; }; container_scan_bindings generic-api /generic-api stable-config`
    ),
    (error) => error.code === 2
  );
});
