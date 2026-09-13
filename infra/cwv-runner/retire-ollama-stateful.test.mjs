import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const root = new URL('.', import.meta.url);
const script = new URL('./retire-ollama.sh', root);
const execFileAsync = promisify(execFile);
const unprivilegedExecution =
  process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const fixtureId = (index) => String(index + 1).padStart(64, '0');
test('keeps generated container IDs unique beyond four fixture rows', () => {
  assert.notEqual(fixtureId(3), fixtureId(4));
});
async function exposeFixture(directory, writable = false) {
  if (process.getuid?.() === 0)
    await chmod(directory, writable ? 0o777 : 0o755);
}

async function scannedContainers(rows) {
  const dir = await mkdtemp(join(tmpdir(), 'baci-ollama-container-scan-'));
  const bin = join(dir, 'bin');
  const normalizedRows = rows.map((row, index) => {
    const id = fixtureId(index);
    return { ...row, id, detail: row.detail.replace(/^[^ ]+/, id) };
  });
  try {
    await mkdir(bin);
    const docker = join(bin, 'docker');
    await writeFile(
      docker,
      `#!/bin/sh\ncase "$*" in *' ps '*) printf '%s\\n' '${normalizedRows
        .map(({ id }) => id)
        .join(' ')}' | tr ' ' '\\n';; *inspect*) case "$*" in ${normalizedRows
        // biome-ignore format: compact Docker fixture case table.
        .map(
        ({ id, name, detail, mounts = '[]' }) =>
          `*'{{.Id}}'*${id}*) printf '%s\\n' '${detail}' ;; *'{{.Name}}'*${id}*) printf '%s\\n' '/${name}' ;; *'{{json .Mounts}}'*${id}*) printf '%s\\n' '${mounts}' ;; *'{{json .State.Running}}'*${id}*) printf 'false\\n' ;;`
      ).join(
        ' '
      )} esac;; *' cp '*) destination=\${5}; printf '#!/bin/sh\\nexit 0\\n' >"$destination";; esac\n`
    );
    await execFileAsync('chmod', ['0755', docker]);
    await exposeFixture(dir);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        '. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all',
        'retire-ollama-container-test',
        script.pathname,
      ],
      {
        ...unprivilegedExecution,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: bin,
        },
      }
    );
    return stdout.trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const scan = ({ unitState, timerState, container, records }) => ({
  units: [
    { name: 'ollama.service', state: unitState },
    { name: 'ollama-watchdog.timer', state: timerState },
  ],
  container,
  model: { treeSha256: 'model-before-delete', byteCount: '4096' },
  records,
});

const records = (systemdDefinitions, changingSuffix) => [
  { class: 'systemd-definitions', sha256: systemdDefinitions },
  { class: 'systemd-fragments', sha256: 'unit-definition' },
  { class: 'running-processes', sha256: `processes-${changingSuffix}` },
  { class: 'systemd-timers', sha256: `timers-${changingSuffix}` },
  { class: 'running-containers', sha256: `running-${changingSuffix}` },
  { class: 'container-definitions', sha256: `containers-${changingSuffix}` },
  { class: 'container-config', sha256: `config-${changingSuffix}` },
  { class: 'model-store-identity', treeSha256: 'model-before-delete' },
];
async function sameDeleteModelsView(baseline, current) {
  const dir = await mkdtemp(join(tmpdir(), 'baci-ollama-stateful-'));
  const before = join(dir, 'before.json');
  const after = join(dir, 'after.json');
  const beforeNormalized = join(dir, 'before.normalized.json');
  const afterNormalized = join(dir, 'after.normalized.json');
  try {
    await Promise.all([
      writeFile(before, JSON.stringify(baseline)),
      writeFile(after, JSON.stringify(current)),
    ]);
    await execFileAsync('sh', [
      '-c',
      '. "$1"; normalize_revalidation_snapshot "$2" "$3" delete_models; normalize_revalidation_snapshot "$4" "$5" delete_models; cmp -s "$3" "$5"',
      'retire-ollama-stateful-test',
      script.pathname,
      before,
      beforeNormalized,
      after,
      afterNormalized,
    ]);
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function deleteVerifiedModels() {
  const dir = await mkdtemp(join(tmpdir(), 'baci-ollama-model-delete-'));
  const store = join(dir, 'store');
  const receipt = join(dir, 'receipt.json');
  try {
    await mkdir(store);
    await writeFile(join(store, 'model.bin'), 'retire me');
    await writeFile(
      receipt,
      JSON.stringify({ scan: { model: { treeSha256: 'model-before-delete' } } })
    );
    await execFileAsync('sh', [
      '-c',
      '. "$1"; STORE="$2"; RECEIPT="$3"; model_identity() { printf "model-before-delete\\n"; }; assert_postcondition() { [ "$1" = delete_models ] && [ ! -e "$STORE" ]; }; delete_models',
      'retire-ollama-model-delete-test',
      script.pathname,
      store,
      receipt,
    ]);
    await assert.rejects(readFile(join(store, 'model.bin')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('accepts the active-to-disabled, container-removed state before model deletion', async () => {
  const baseline = scan({
    unitState: 'loaded:enabled:active',
    timerState: 'loaded:enabled:active',
    container: { name: 'ollama-loopback', fullId: 'before' },
    records: records('systemd-unchanged', 'before'),
  });
  const afterDisableAndRemoval = scan({
    unitState: 'loaded:disabled:inactive',
    timerState: 'loaded:disabled:inactive',
    container: { name: 'ollama-loopback', fullId: 'removed' },
    records: records('systemd-unchanged', 'after-removal'),
  });

  assert.equal(
    await sameDeleteModelsView(baseline, afterDisableAndRemoval),
    true
  );
  await deleteVerifiedModels();
});

test('retains unrelated authority drift detection before model deletion', async () => {
  const baseline = scan({
    unitState: 'loaded:enabled:active',
    timerState: 'loaded:enabled:active',
    container: { name: 'ollama-loopback', fullId: 'before' },
    records: records('systemd-unchanged', 'before'),
  });
  const mutatedAuthority = scan({
    unitState: 'loaded:disabled:inactive',
    timerState: 'loaded:disabled:inactive',
    container: { name: 'ollama-loopback', fullId: 'removed' },
    records: records('systemd-drifted', 'after-removal'),
  });

  assert.equal(await sameDeleteModelsView(baseline, mutatedAuthority), false);
});

test('does not classify an unrelated Baci container as an Ollama consumer', async () => {
  assert.equal(
    await scannedContainers([
      {
        id: 'baci-web',
        name: 'baci-web',
        detail:
          'baci-web /baci-web /bin/true [] [] "" {} null [] {} {} {} [] "bridge"',
      },
    ]),
    ''
  );
});

test('ignores an unrelated container that disappears during inspect', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'baci-ollama-container-race-'));
  const bin = join(dir, 'bin');
  const state = join(dir, 'ps-seen');
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, 'docker'),
      '#!/bin/sh\ncase "$*" in *\' ps \'*) if [ ! -e "$RETIRE_OLLAMA_TEST_STATE" ]; then : >"$RETIRE_OLLAMA_TEST_STATE"; printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\n"; else printf "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\n"; fi;; *\'{{.Id}}\'*bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) printf "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb /kept /bin/true [] [] \\"\\" {} null [] {} {} {} [] \\"bridge\\"\\n";; *\'{{.Name}}\'*bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) printf "/kept\\n";; *\'{{json .Mounts}}\'*bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) printf "[]\\n";; *\'{{json .State.Running}}\'*bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) printf "false\\n";; *\' cp \'*bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:\'/bin/true \'*) destination=$5; printf "#!/bin/sh\\nexit 0\\n" >"$destination";; *\' inspect \'*aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) exit 1;; esac\n'
    );
    await execFileAsync('chmod', ['0755', join(bin, 'docker')]);
    await exposeFixture(dir, true);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        '. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all',
        'retire-ollama-container-race-test',
        script.pathname,
      ],
      {
        ...unprivilegedExecution,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: bin,
          RETIRE_OLLAMA_TEST_STATE: state,
        },
      }
    );
    assert.equal(stdout, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preserves a persistent Docker inspect failure after inventory retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'baci-ollama-container-inspect-'));
  const bin = join(dir, 'bin');
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, 'docker'),
      '#!/bin/sh\ncase "$*" in *\' ps \'*) printf "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\\n";; *\' inspect \'*) exit 42;; esac\n'
    );
    await execFileAsync('chmod', ['0755', join(bin, 'docker')]);
    await exposeFixture(dir);
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          '. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/tmp/docker.sock; scan_container_rows all',
          'retire-ollama-container-inspect-race-test',
          script.pathname,
        ],
        {
          ...unprivilegedExecution,
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: bin,
          },
        }
      ),
      (error) => error.code === 42 || error.status === 42
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('classifies a container with an Ollama endpoint as a consumer', async () => {
  assert.match(
    await scannedContainers([
      {
        id: 'baci-worker',
        name: 'baci-worker',
        detail:
          'baci-worker /baci-worker /bin/true [] [OLLAMA_HOST=http://127.0.0.1:11434] "" {} null [] {} {} {} [] "bridge"',
      },
    ]),
    /OLLAMA_HOST/
  );
});

test('classifies a generic container that publishes port 11434 without an Ollama name', async () => {
  assert.match(
    await scannedContainers([
      {
        id: 'generic-api',
        name: 'generic-api',
        detail:
          'generic-api /generic-api /bin/true [] [] "" {} null [] {"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]} {"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]} {} [] "bridge"',
      },
    ]),
    /11434/
  );
});
