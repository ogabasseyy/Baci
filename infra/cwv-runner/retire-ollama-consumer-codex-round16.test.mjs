import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
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
const prelude =
  'RETIRE_OLLAMA_TEST_BIN=/usr/bin; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; stat() { printf "1:2:81a4:10:0:0:600\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

test('traverses a custom Compose file selected directly by system cron', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-cron-compose-reference-'))
  );
  const units = join(directory, 'units');
  const project = join(directory, 'application');
  const compose = join(project, 'production-stack.yml');
  const cron = join(directory, 'crontab');
  const manifest = join(directory, 'cron-manifest.tsv');
  try {
    await Promise.all([mkdir(units), mkdir(project)]);
    await Promise.all([
      writeFile(
        compose,
        'services:\n  app:\n    environment:\n      OLLAMA_HOST: http://127.0.0.1:11434\n'
      ),
      writeFile(
        cron,
        `* * * * * root /usr/bin/docker compose -f ${compose} up -d\n`
      ),
      writeFile(manifest, `system\t-\t${cron}\n`),
    ]);

    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; SYSTEMD_ROOTS="$2"; COMPOSE_ROOTS="$3"; CRON_SOURCE="$4"; RETIRE_OLLAMA_CRON_SOURCES="$5"; cron_inventory_anacrontab() { printf '/not-anacron\\n'; }; cron_inventory_system_file() { printf '%s\\n' "$CRON_SOURCE"; }; cron_inventory_system_dir() { printf '/etc/cron.d\\n'; }; cron_inventory_command_targets() { printf '/usr/bin/docker\\n'; }; scan_compose_definitions`,
      'retire-ollama-cron-compose-test',
      script.pathname,
      units,
      project,
      cron,
      manifest,
    ]);

    assert.match(
      stdout,
      new RegExp(`^${compose.replaceAll('/', '\\/')}\\|`, 'm')
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('unwraps env before traversing a custom Compose file from cron', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-cron-env-compose-reference-'))
  );
  const units = join(directory, 'units');
  const project = join(directory, 'application');
  const compose = join(project, 'workload.yml');
  const cron = join(directory, 'crontab');
  const manifest = join(directory, 'cron-manifest.tsv');
  try {
    await Promise.all([mkdir(units), mkdir(project)]);
    await Promise.all([
      writeFile(compose, 'services:\n  app:\n    image: hidden-image\n'),
      writeFile(
        cron,
        `* * * * * root /usr/bin/env docker compose -f ${compose} up\n`
      ),
      writeFile(manifest, `system\t-\t${cron}\n`),
    ]);

    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; SYSTEMD_ROOTS="$2"; COMPOSE_ROOTS="$3"; CRON_SOURCE="$4"; RETIRE_OLLAMA_CRON_SOURCES="$5"; cron_inventory_anacrontab() { printf '/not-anacron\\n'; }; cron_inventory_system_file() { printf '%s\\n' "$CRON_SOURCE"; }; cron_inventory_system_dir() { printf '/etc/cron.d\\n'; }; cron_inventory_command_targets() { printf '/usr/bin/env\\n'; }; compose_image_configuration() { printf 'sha256:%064d {"Env":["OLLAMA_HOST=http://127.0.0.1:11434"]}\\n' 0; }; scan_compose_definitions`,
      'retire-ollama-cron-env-compose-test',
      script.pathname,
      units,
      project,
      cron,
      manifest,
    ]);

    assert.match(stdout, /compose-image:/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('does not consult ambient cron without a caller-owned manifest', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-no-ambient-cron-'))
  );
  const units = join(directory, 'units');
  const marker = join(directory, 'ambient-cron-called');
  try {
    await mkdir(units);
    await execFileAsync('sh', [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; SYSTEMD_ROOTS="$3"; load_cron_inventory_helper() { : >"$4"; return 2; }; cron_inventory_collect_external() { : >"$4"; return 2; }; output=$(temp_path); compose_cli_reference_inventory "$output"; [ ! -s "$output" ]`,
      'retire-ollama-no-ambient-cron-test',
      script.pathname,
      directory,
      units,
      marker,
    ]);

    await assert.rejects(access(marker));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('binds a stopped container internal absolute configuration argument', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-internal-argument-'))
  );
  try {
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}docker() { case "$*" in *' ps -a '*) printf '${containerId}\\n' ;; *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;; *'inspect -f {{json .Args}} ${containerId}') printf '["--config","/etc/application.conf"]\\n' ;; *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;; *'inspect -f {{.Id}} '*) printf '${containerId} /generic-api /bin/true ["--config","/etc/application.conf"] [] {} null [] {} {} {} [] "bridge"\\n' ;; *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;; *' cp ${containerId}:/bin/true '*) for destination do :; done; printf '#!/bin/sh\\nexit 0\\n' >"$destination" ;; *' cp ${containerId}:/etc/application.conf '*) for destination do :; done; printf 'OLLAMA_HOST=http://127.0.0.1:11434\\n' >"$destination" ;; *) return 2 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; CONTAINER=ollama-loopback; scan_container_rows all`,
      'retire-ollama-container-argument-test',
      script.pathname,
      directory,
    ]);

    assert.match(
      stdout,
      new RegExp(`^container-argument:${containerId}:.*application\\.conf`, 'm')
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('accepts only the canonical merged-usr alias for rooted wrapper exec', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-merged-usr-'))
  );
  const usrBin = join(directory, 'usr', 'bin');
  const executable = join(usrBin, 'true');
  try {
    await mkdir(usrBin, { recursive: true });
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await symlink('usr/bin', join(directory, 'bin'));

    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; systemd_rooted_target "$2" /bin/true`,
      'retire-ollama-merged-usr-test',
      script.pathname,
      directory,
    ]);

    assert.equal(stdout.trim(), executable);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
