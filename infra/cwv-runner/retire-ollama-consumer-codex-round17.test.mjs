import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
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
const prelude =
  'RETIRE_OLLAMA_TEST_BIN=/usr/bin; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; stat() { printf "1:2:81a4:10:0:0:600\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

async function cronComposeFixture(command) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-cron-flock-compose-'))
  );
  const units = join(directory, 'units');
  const project = join(directory, 'application');
  const compose = join(project, 'custom.yml');
  const cron = join(directory, 'crontab');
  const manifest = join(directory, 'cron-manifest.tsv');
  await Promise.all([mkdir(units), mkdir(project)]);
  await Promise.all([
    writeFile(
      compose,
      'services:\n  app:\n    environment:\n      OLLAMA_HOST: http://127.0.0.1:11434\n'
    ),
    writeFile(cron, `* * * * * root ${command(compose)}\n`),
    writeFile(manifest, `system\t-\t${cron}\n`),
  ]);
  return { compose, cron, directory, manifest, project, units };
}

function scanCronCompose({ cron, directory, manifest, project, units }) {
  return execFileAsync('sh', [
    '-c',
    `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; load_cron_inventory_helper; RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; SYSTEMD_ROOTS="$3"; COMPOSE_ROOTS="$4"; RETIRE_OLLAMA_CRON_SOURCES="$5"; RETIRE_OLLAMA_CRON_SYSTEM_FILE="$6"; RETIRE_OLLAMA_CRON_SYSTEM_DIR="$2/cron.d"; RETIRE_OLLAMA_ANACRONTAB="$2/anacrontab"; RETIRE_OLLAMA_CRON_HOURLY_DIR="$2/hourly"; RETIRE_OLLAMA_CRON_DAILY_DIR="$2/daily"; RETIRE_OLLAMA_CRON_WEEKLY_DIR="$2/weekly"; RETIRE_OLLAMA_CRON_MONTHLY_DIR="$2/monthly"; scan_compose_definitions`,
    'retire-ollama-cron-flock-compose-test',
    script.pathname,
    directory,
    units,
    project,
    manifest,
    cron,
  ]);
}

test('unwraps an exact validated flock launcher before Compose CLI parsing', async () => {
  const fixture = await cronComposeFixture(
    (compose) =>
      `/usr/bin/flock -n /run/application.lock /usr/bin/docker compose -f ${compose} up`
  );
  try {
    const { stdout } = await scanCronCompose(fixture);
    assert.match(
      stdout,
      new RegExp(`^${fixture.compose.replaceAll('/', '\\/')}\\|`, 'm')
    );
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test('fails closed on an unsupported flock command-string Compose launcher', async () => {
  const fixture = await cronComposeFixture(
    (compose) =>
      `/usr/bin/flock -n /run/application.lock -c "/usr/bin/docker compose -f ${compose} up"`
  );
  try {
    await assert.rejects(scanCronCompose(fixture), (error) => error.code === 2);
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test('content-binds a stopped container absolute Path when Args is empty', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-internal-path-'))
  );
  try {
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}docker() { case "$*" in *' ps -a '*) printf '${containerId}\\n' ;; *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;; *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;; *'inspect -f {{.Id}} '*) printf '${containerId} /generic-api /opt/application-worker [] [] {} null [] {} {} {} [] "bridge"\\n' ;; *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;; *' cp ${containerId}:/opt/application-worker '*) for destination do :; done; printf '#!/bin/sh\\nexec /usr/bin/curl http://127.0.0.1:11434\\n' >"$destination" ;; *' cp ${containerId}:/usr/bin/curl '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;; *) return 2 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; CONTAINER=ollama-loopback; scan_container_rows all`,
      'retire-ollama-container-path-test',
      script.pathname,
      directory,
    ]);

    const records = stdout.trim().split('\n');
    assert.equal(records.length, 2);
    assert.match(
      records[0],
      new RegExp(`^container-argument:${containerId}:.*application-worker`)
    );
    assert.match(
      records[1],
      new RegExp(`^container-argument:${containerId}:.*usr\\/bin\\/curl`)
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function cronExecFixture(execLine) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-cron-exec-closure-'))
  );
  const wrapper = join(directory, 'application-wrapper');
  const worker = join(directory, 'application-worker');
  await Promise.all([
    writeFile(wrapper, `#!/bin/sh\n${execLine(worker)}\n`),
    writeFile(worker, '#!/bin/sh\ncurl http://127.0.0.1:11434\n'),
  ]);
  await Promise.all([chmod(wrapper, 0o755), chmod(worker, 0o755)]);
  return { directory, worker, wrapper };
}

function scanCronWrapper({ directory, wrapper }) {
  return execFileAsync('sh', [
    '-c',
    `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; load_cron_inventory_helper; RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; records='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; cron_inventory_record_wrapper_closure system-crontab "$3"; printf '%s\\n' "$consumer_counts"`,
    'retire-ollama-cron-exec-test',
    script.pathname,
    directory,
    wrapper,
  ]);
}

test('traverses a safe static absolute exec target in a cron wrapper', async () => {
  const fixture = await cronExecFixture((worker) => `exec ${worker}`);
  try {
    const { stdout } = await scanCronWrapper(fixture);
    const counts = JSON.parse(stdout);
    assert.equal(counts.at(-1)?.matchCount, 1);
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test('fails closed on a dynamic exec target in a cron wrapper', async () => {
  const fixture = await cronExecFixture(() => 'exec "$WORKER"');
  try {
    await assert.rejects(scanCronWrapper(fixture), (error) => error.code === 2);
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});
