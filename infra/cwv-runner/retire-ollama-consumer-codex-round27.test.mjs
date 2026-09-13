import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const prelude =
  'RETIRE_OLLAMA_TEST_BIN=/usr/bin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; stat() { printf "1:2:81a4:10:0:0:600\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

test('fails closed before accepting a flow-style Compose services map', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-flow-services-'))
  );
  const marker = join(directory, 'docker-called');
  try {
    await writeFile(
      join(directory, 'compose.yaml'),
      'services: { app: { image: hidden-image } }\n'
    );
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${prelude}docker() { : >"$3"; printf 'sha256:${'a'.repeat(64)} {"Env":["ENDPOINT=http://127.0.0.1:11434"]}\\n'; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions`,
        'retire-ollama-compose-flow-services-test',
        script.pathname,
        directory,
        marker,
      ]),
      (error) => error.code === 2
    );
    await assert.rejects(realpath(marker));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed before accepting a quoted Compose services key', async () => {
  await assert.rejects(
    execFileAsync('sh', [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf '"services":\\n  app:\\n    image: hidden-image\\n' | compose_image_refs /dev/stdin`,
      'retire-ollama-compose-quoted-services-test',
      script.pathname,
    ]),
    (error) => error.code === 2
  );
});

test('fails closed before accepting whitespace before a Compose services colon', async () => {
  await assert.rejects(
    execFileAsync('sh', [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf 'services :\\n  app:\\n    image: hidden-image\\n' | compose_image_refs /dev/stdin`,
      'retire-ollama-compose-services-spacing-test',
      script.pathname,
    ]),
    (error) => error.code === 2
  );
});

test('fails closed before accepting whitespace before a Compose build colon', async () => {
  await assert.rejects(
    execFileAsync('sh', [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf 'services:\\n  app:\\n    build : ./app\\n' | compose_build_refs /dev/stdin`,
      'retire-ollama-compose-build-spacing-test',
      script.pathname,
    ]),
    (error) => error.code === 2
  );
});

test('discovers images beneath a consistently indented Compose root', async () => {
  const { stdout } = await execFileAsync('sh', [
    '-c',
    `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf '  services:\\n    app:\\n      image: hidden-image\\n' | compose_image_refs /dev/stdin`,
    'retire-ollama-compose-indented-root-test',
    script.pathname,
  ]);
  assert.equal(stdout, 'hidden-image\n');
});

test('fails closed before accepting a quoted Compose image key', async () => {
  await assert.rejects(
    execFileAsync('sh', [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf 'services:\\n  app:\\n    "image": hidden-image\\n' | compose_image_refs /dev/stdin`,
      'retire-ollama-compose-quoted-image-test',
      script.pathname,
    ]),
    (error) => error.code === 2
  );
});

test('keeps scanning services after a root-level blank line', async () => {
  const { stdout } = await execFileAsync('sh', [
    '-c',
    `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf 'services:\\n\\n  app:\\n    image: hidden-image\\n' | compose_image_refs /dev/stdin`,
    'retire-ollama-compose-services-blank-test',
    script.pathname,
  ]);
  assert.equal(stdout, 'hidden-image\n');
});

test('keeps scanning dockerfile_inline after a leading blank line', async () => {
  const { stdout } = await execFileAsync('sh', [
    '-c',
    `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf 'services:\\n  app:\\n    build:\\n      dockerfile_inline: |\\n\\n        FROM hidden-image\\n' | compose_inline_dockerfiles /dev/stdin`,
    'retire-ollama-compose-inline-blank-test',
    script.pathname,
  ]);
  assert.equal(stdout, 'FROM hidden-image\n');
});

test('does not treat dockerfile_inline payload as a spaced YAML key', async () => {
  await execFileAsync('sh', [
    '-c',
    `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf 'services:\\n  app:\\n    build:\\n      dockerfile_inline: |\\n        RUN : hidden-command\\n' | compose_mapping_key_spacing_guard /dev/stdin`,
    'retire-ollama-compose-inline-payload-test',
    script.pathname,
  ]);
});

for (const header of ['|2', '>2-', '|+2']) {
  test(`recognizes ${header} as a Compose block scalar header`, async () => {
    const input = `services:\n  app:\n    build:\n      dockerfile_inline: ${header}\n        RUN : hidden-command\n    image: visible-image\n`;
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf '%s' "$2" | compose_image_refs /dev/stdin`,
      'retire-ollama-compose-block-indicator-image-test',
      script.pathname,
      input,
    ]);
    assert.equal(stdout, 'visible-image\n');
    await execFileAsync('sh', [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf '%s' "$2" | compose_mapping_key_spacing_guard /dev/stdin`,
      'retire-ollama-compose-block-indicator-guard-test',
      script.pathname,
      input,
    ]);
  });
}

test('discovers an include beneath a consistently indented Compose root', async () => {
  const { stdout } = await execFileAsync('sh', [
    '-c',
    `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; printf '  include: child.yaml\\n' | compose_include_refs /dev/stdin`,
    'retire-ollama-compose-indented-include-test',
    script.pathname,
  ]);
  assert.equal(stdout, 'child.yaml\n');
});

test('binds a static systemd BindReadOnlyPaths source', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-static-bind-path-'))
  );
  const units = join(directory, 'units');
  const source = join(directory, 'application.conf');
  try {
    await mkdir(units);
    await Promise.all([
      writeFile(source, 'endpoint=http://127.0.0.1:11434\n'),
      writeFile(
        join(units, 'application.service'),
        `[Service]\nBindReadOnlyPaths=${source}:/etc/application.conf:rbind\nExecStart=/bin/true\n`
      ),
    ]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}getent() { return 2; }; systemctl() { return 0; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); SYSTEMD_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_systemd_consumers`,
      'retire-ollama-static-bind-path-test',
      script.pathname,
      units,
    ]);
    assert.match(stdout, new RegExp(`\\|${source}\\|`));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('binds a runtime systemd BindPaths source', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-systemd-runtime-bind-path-'))
  );
  const source = join(directory, 'application.conf');
  try {
    await writeFile(source, 'endpoint=http://127.0.0.1:11434\n');
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${prelude}source=$2; . "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; systemd_runtime_inventory() { printf 'application.service loaded inactive dead fixture\\n' >"$2"; }; systemd_manager_call() { printf 'RootDirectory=\\nRootImage=\\nWorkingDirectory=\\nEnvironment=\\nEnvironmentFiles=\\nPassEnvironment=\\nLoadCredential=\\nLoadCredentialEncrypted=\\nStandardInput=null\\nBindPaths=%s:/etc/application.conf:norbind\\nBindReadOnlyPaths=\\nExecStart={}\\n' "$source"; }; scan_systemd_runtime_consumers system`,
      'retire-ollama-runtime-bind-path-test',
      script.pathname,
      source,
    ]);
    assert.match(
      stdout,
      new RegExp(`^application\\.service:${source}\\|`, 'm')
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('rejects an unsupported systemd bind recursion mode', async () => {
  await assert.rejects(
    execFileAsync('sh', [
      '-c',
      `RETIRE_OLLAMA_TEST_BIN=/usr/bin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; init_temp_root; trap cleanup_temp EXIT; systemd_bind_path_targets '/srv/config:/etc/config:recursive'`,
      'retire-ollama-bind-recursion-mode-test',
      script.pathname,
    ]),
    (error) => error.code === 2
  );
});
