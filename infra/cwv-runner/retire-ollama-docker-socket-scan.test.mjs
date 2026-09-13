import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

function run(identityScript) {
  const shell = `. "$1"
CANONICAL_DOCKER_SOCKET=/run/docker.sock
DOCKER_SOCKET_IDENTITY=''
assert_docker_socket() { DOCKER_SOCKET_IDENTITY=$(${identityScript}); }
docker_socket_scan_begin
docker_socket_scan_end
`;
  return execFileAsync('sh', [
    '-c',
    shell,
    'docker-socket-scan-test',
    script.pathname,
  ]);
}

test('accepts an unchanged Docker socket identity across the normal scan', async () => {
  await run("printf '%s' stable");
});

test('fails closed when the Docker socket identity changes during the normal scan', async () => {
  const shell = `. "$1"
CANONICAL_DOCKER_SOCKET=/run/docker.sock
DOCKER_SOCKET_IDENTITY=''
socket_calls=0
assert_docker_socket() { socket_calls=$((socket_calls + 1)); if [ "$socket_calls" -eq 1 ]; then DOCKER_SOCKET_IDENTITY=before; else DOCKER_SOCKET_IDENTITY=replaced; fi; }
docker_socket_scan_begin
docker_socket_scan_end
`;
  await assert.rejects(
    execFileAsync('sh', [
      '-c',
      shell,
      'docker-socket-scan-race-test',
      script.pathname,
    ]),
    (error) => error.code === 78
  );
});
