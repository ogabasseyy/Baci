import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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

async function wrapperFixture(execLine) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-cron-exec-arguments-'))
  );
  const wrapper = join(directory, 'application-wrapper');
  const worker = join(directory, 'application-worker');
  const configuration = join(directory, 'application.conf');
  await Promise.all([
    writeFile(wrapper, `#!/bin/sh\n${execLine({ configuration, worker })}\n`),
    writeFile(worker, '#!/bin/sh\nexit 0\n'),
    writeFile(configuration, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
  ]);
  await Promise.all([chmod(wrapper, 0o755), chmod(worker, 0o755)]);
  return { configuration, directory, worker, wrapper };
}

function scanWrapper({ directory, wrapper }) {
  return execFileAsync('sh', [
    '-c',
    `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; load_cron_inventory_helper; RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; records='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; cron_inventory_record_wrapper_closure system-crontab "$3"; jq -cn --argjson records "$records" --argjson counts "$consumer_counts" '{records:$records,counts:$counts}'`,
    'retire-ollama-cron-exec-arguments-test',
    script.pathname,
    directory,
    wrapper,
  ]);
}

test('binds every safe absolute regular-file token in a cron wrapper exec', async () => {
  const fixture = await wrapperFixture(
    ({ configuration, worker }) => `exec ${worker} --config ${configuration}`
  );
  try {
    const result = JSON.parse((await scanWrapper(fixture)).stdout);
    assert.deepEqual(
      result.records.map(({ realPath }) => realPath),
      [fixture.wrapper, fixture.worker, fixture.configuration]
    );
    assert.deepEqual(
      result.counts.map(({ matchCount }) => matchCount),
      [0, 0, 1]
    );
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test('fails closed on a dynamic cron wrapper exec argument', async () => {
  const fixture = await wrapperFixture(
    ({ worker }) => `exec ${worker} --config "$APPLICATION_CONFIG"`
  );
  try {
    await assert.rejects(scanWrapper(fixture), (error) => error.code === 2);
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

function scanContainer(directory, wrapperBody, workerBody) {
  return execFileAsync('sh', [
    '-c',
    `${prelude}wrapper_body=$3; worker_body=$4; docker() { case "$*" in *' ps -a '*) printf '${containerId}\\n' ;; *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;; *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;; *'inspect -f {{.Id}} '*) printf '${containerId} /generic-api /opt/application-wrapper [] [] {} null [] {} {} {} [] "bridge"\\n' ;; *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;; *' cp ${containerId}:/opt/application-wrapper '*) for destination do :; done; printf '%s' "$wrapper_body" >"$destination" ;; *' cp ${containerId}:/opt/application-worker '*) for destination do :; done; printf '%s' "$worker_body" >"$destination" ;; *) return 2 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; CONTAINER=ollama-loopback; scan_container_rows all`,
    'retire-ollama-container-path-closure-test',
    script.pathname,
    directory,
    wrapperBody,
    workerBody,
  ]);
}

test('recursively binds a stopped container Path static exec closure', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-path-closure-'))
  );
  try {
    const { stdout } = await scanContainer(
      directory,
      '#!/bin/sh\nexec /opt/application-worker\n',
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

test('fails closed on a dynamic stopped-container Path exec target', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-path-dynamic-'))
  );
  try {
    await assert.rejects(
      scanContainer(
        directory,
        '#!/bin/sh\nexec "$APPLICATION_WORKER"\n',
        '#!/bin/sh\nexit 0\n'
      ),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('rejects an unescaped cron percent before resolving its target', async () => {
  const fixture = await wrapperFixture(({ worker }) => `exec ${worker}`);
  const cron = join(fixture.directory, 'crontab');
  await writeFile(cron, `* * * * * root ${fixture.wrapper} % payload\n`);
  try {
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; load_cron_inventory_helper; RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; records='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; cron_inventory_record_wrapper_consumers system-crontab system "$3" "$3"`,
        'retire-ollama-cron-percent-test',
        script.pathname,
        fixture.directory,
        cron,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});
