import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const closure = new URL('./retire-ollama-consumer-closure.sh', import.meta.url);
const containerId =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const prelude =
  'RETIRE_OLLAMA_TEST_BIN=/usr/bin; sha256sum() { if [ -x /usr/bin/sha256sum ]; then /usr/bin/sha256sum "$@"; elif [ -x /bin/sha256sum ]; then /bin/sha256sum "$@"; elif [ -x /usr/bin/shasum ]; then /usr/bin/shasum -a 256 "$@"; else return 2; fi; }; stat() { printf "1:2:81a4:10:0:0:600\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

function scanContainer(directory, option) {
  return execFileAsync('sh', [
    '-c',
    `${prelude}option=$3; docker() { case "$*" in *' ps -a '*) printf '${containerId}\\n' ;; *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;; *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;; *'inspect -f {{.Id}} '*) printf '${containerId} /generic-api /opt/application-wrapper [] [] {} null [] {} {} {} [] "bridge"\\n' ;; *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;; *' cp ${containerId}:/opt/application-wrapper '*) for destination do :; done; printf '#!/bin/sh\\nMODE=prod exec /opt/application-worker %s\\n' "$option" >"$destination" ;; *' cp ${containerId}:/opt/application-worker '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;; *' cp ${containerId}:/etc/application.conf '*) for destination do :; done; printf 'endpoint=http://127.0.0.1:11434\\n' >"$destination" ;; *) return 2 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; CONTAINER=ollama-loopback; scan_container_rows all`,
    'retire-ollama-container-wrapper-option-test',
    script.pathname,
    directory,
    option,
  ]);
}

test('binds a stopped assignment-prefixed wrapper option file', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-wrapper-option-'))
  );
  try {
    const { stdout } = await scanContainer(
      directory,
      '-c=/etc/application.conf'
    );
    const records = stdout.trim().split('\n');
    assert.equal(records.length, 3);
    assert.match(records[0], /application-wrapper/);
    assert.match(records[1], /application-worker/);
    assert.match(records[2], /application\.conf/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed on an unsafe assignment-prefixed wrapper option', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-wrapper-unsafe-option-'))
  );
  try {
    await assert.rejects(
      scanContainer(directory, '-c=/tmp/../application.conf'),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed on unmodeled slash tokens in a container wrapper', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-wrapper-slash-token-'))
  );
  const wrapper = join(directory, 'wrapper');
  try {
    for (const line of [
      'exec /opt/application-worker config/application.conf',
      'exec /opt/application-worker --bad@=/etc/secret',
    ]) {
      await writeFile(wrapper, `#!/bin/sh\n${line}\n`, { mode: 0o755 });
      await assert.rejects(
        execFileAsync('sh', [
          '-c',
          '. "$1"; container_wrapper_exec_paths "$2"',
          'retire-ollama-container-wrapper-slash-token-test',
          closure.pathname,
          wrapper,
        ]),
        (error) => error.code === 2
      );
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed on a stopped-container bare wrapper executable', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-wrapper-bare-worker-'))
  );
  try {
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${prelude}docker() { case "$*" in *' ps -a '*) printf '${containerId}\\n' ;; *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;; *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;; *'inspect -f {{.Id}} '*) printf '${containerId} /generic-api /usr/bin/wrapper [] [] {} null [] {} {} {} [] "bridge"\\n' ;; *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;; *' cp ${containerId}:/usr/bin/wrapper '*) for destination do :; done; printf '#!/bin/sh\\nworker\\n' >"$destination" ;; *' cp ${containerId}:/usr/bin/worker '*) for destination do :; done; printf '#!/bin/sh\\nOLLAMA_HOST=http://127.0.0.1:11434\\n' >"$destination" ;; *) return 2 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; CONTAINER=ollama-loopback; scan_container_rows all`,
        'retire-ollama-container-wrapper-bare-worker-test',
        script.pathname,
        directory,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
