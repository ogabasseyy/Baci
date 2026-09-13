import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const containerId =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const prelude =
  'RETIRE_OLLAMA_TEST_BIN=/usr/bin; sha256sum() { if [ -x /usr/bin/sha256sum ]; then /usr/bin/sha256sum "$@"; elif [ -x /bin/sha256sum ]; then /bin/sha256sum "$@"; elif [ -x /usr/bin/shasum ]; then /usr/bin/shasum -a 256 "$@"; else return 2; fi; }; stat() { printf "1:2:81a4:10:0:0:600\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

function scanContainer(directory, wrapperBody, workerBody) {
  return execFileAsync('sh', [
    '-c',
    `${prelude}wrapper_body=$3; worker_body=$4; docker() { case "$*" in *' ps -a '*) printf '${containerId}\\n' ;; *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;; *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;; *'inspect -f {{.Id}} '*) printf '${containerId} /generic-api /opt/application-wrapper [] [] {} null [] {} {} {} [] "bridge"\\n' ;; *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;; *' cp ${containerId}:/opt/application-wrapper '*) for destination do :; done; printf '%s' "$wrapper_body" >"$destination" ;; *' cp ${containerId}:/opt/application-worker '*) for destination do :; done; printf '%s' "$worker_body" >"$destination" ;; *) return 2 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; CONTAINER=ollama-loopback; scan_container_rows all`,
    'retire-ollama-container-plain-child-test',
    script.pathname,
    directory,
    wrapperBody,
    workerBody,
  ]);
}

test('binds a stopped-container wrapper plain absolute child command', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-plain-child-'))
  );
  try {
    const { stdout } = await scanContainer(
      directory,
      '#!/bin/sh\n/opt/application-worker\n',
      '#!/bin/sh\ncurl http://127.0.0.1:11434\n'
    );
    const records = stdout.trim().split('\n');
    assert.equal(records.length, 2);
    assert.match(records[0], /application-wrapper/);
    assert.match(records[1], /application-worker/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed on a dynamic stopped-container plain child command', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-dynamic-child-'))
  );
  try {
    await assert.rejects(
      scanContainer(
        directory,
        '#!/bin/sh\n"$APPLICATION_WORKER"\n',
        '#!/bin/sh\nexit 0\n'
      ),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
