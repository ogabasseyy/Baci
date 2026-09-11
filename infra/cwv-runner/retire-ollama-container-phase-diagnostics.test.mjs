import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chown, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};

const runScan = async (body) => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-container-phase-'));
  try {
    if (unprivileged.uid !== undefined && unprivileged.gid !== undefined) {
      await chown(directory, unprivileged.uid, unprivileged.gid);
    }
    return await execFileAsync(
      'sh',
      [
        '-c',
        `. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; load_consumer_scanners; ${body}`,
        'retire-ollama-container-phase-test',
        script.pathname,
      ],
      {
        ...unprivileged,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
          RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
          RETIRE_OLLAMA_TMPDIR: directory,
        },
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const rejectsWithPhase = async (body, code, phase) => {
  await assert.rejects(runScan(body), (error) => {
    assert.equal(error.code, code);
    assert.equal(
      error.stderr,
      `container-scan-failure phase=${phase} status=${code}\n`
    );
    return true;
  });
};

test('labels an initial container inventory failure without exposing inventory data', async () => {
  await rejectsWithPhase(
    'container_inventory() { printf "inventory-secret" >&2; return 79; }; scan_container_rows all',
    79,
    'inventory-initial'
  );
});

test('labels an initial inventory sort failure and suppresses tool stderr', async () => {
  await rejectsWithPhase(
    'container_inventory() { : >"$2"; }; sort() { printf "sort-secret" >&2; return 73; }; scan_container_rows all',
    73,
    'inventory-initial-sort'
  );
});

test('labels an otherwise unannotated container snapshot failure', async () => {
  await rejectsWithPhase(
    'container_inventory() { : >"$2"; }; scan_container_snapshot() { return 73; }; scan_container_rows all',
    73,
    'inventory-snapshot'
  );
});

test('labels a final container inventory failure independently', async () => {
  await rejectsWithPhase(
    'inventory_count=0; container_inventory() { inventory_count=$((inventory_count + 1)); [ "$inventory_count" -eq 1 ] && : >"$2" || return 79; }; scan_container_rows all',
    79,
    'inventory-final'
  );
});

test('labels a final inventory sort failure and suppresses tool stderr', async () => {
  await rejectsWithPhase(
    'sort_count=0; container_inventory() { : >"$2"; }; sort() { sort_count=$((sort_count + 1)); if [ "$sort_count" -eq 1 ]; then /usr/bin/sort "$@"; else printf "sort-secret" >&2; return 73; fi; }; scan_container_rows all',
    73,
    'inventory-final-sort'
  );
});

test('labels persistent container inventory churn after the bounded retries', async () => {
  await rejectsWithPhase(
    'inventory_count=0; container_inventory() { inventory_count=$((inventory_count + 1)); printf "%064d\n" "$inventory_count" >"$2"; }; scan_container_snapshot() { :; }; scan_container_rows all',
    2,
    'inventory-churn'
  );
});

test('labels an inventory comparison error instead of treating it as churn', async () => {
  await rejectsWithPhase(
    'container_inventory() { : >"$2"; }; scan_container_snapshot() { :; }; cmp() { return 74; }; scan_container_rows all',
    74,
    'inventory-compare'
  );
});

test('labels a terminal per-container inventory refresh instead of the stale scan phase', async () => {
  const containerId = 'a'.repeat(64);
  await assert.rejects(
    runScan(
      `raw=$(temp_path); printf '%s\\n' '${containerId}' >"$raw"; docker() { printf '/generic-api\\n'; }; container_configuration() { return 2; }; container_inventory() { printf 'inventory-secret' >&2; return 79; }; scan_container_snapshot all "$raw"`
    ),
    (error) => {
      assert.equal(error.code, 79);
      assert.equal(error.stdout, '');
      assert.equal(
        error.stderr,
        `container-scan-failure id=${containerId} phase=inventory-refresh status=79\n`
      );
      return true;
    }
  );
});
