import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

function shell(command, args = [], options = {}) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; ${command}`,
      'recovery-receipts-fail-closed-test',
      script.pathname,
      ...args,
    ],
    {
      ...options,
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: '/sbin',
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...(options.env ?? {}),
      },
    }
  );
}

function unprivilegedChildOptions() {
  return process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
}

async function pairFixture(prefix, content = 'a'.repeat(64)) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const pending = join(directory, 'pending');
  const target = join(directory, 'target');
  await Promise.all([writeFile(pending, content), writeFile(target, content)]);
  await Promise.all([chmod(pending, 0o600), chmod(target, 0o600)]);
  return { directory, pending, target };
}

test('refuses to delete a JSON pending link when both identity reads fail', async () => {
  const { directory, pending, target } = await pairFixture(
    'baci-recovery-stat-failure-',
    '{}'
  );
  try {
    const { stdout } = await shell(
      `id() { printf '1000\\n'; }; init_temp_root; trap cleanup_temp EXIT; stat_calls=0; stat() { stat_calls=$((stat_calls + 1)); case "$stat_calls" in 1|2) printf '600\\n';; *) return 1;; esac; }; fsync_dir() { :; }; if recovery_reconcile_duplicate_link "$2" "$3"; then printf deleted; else printf refused; fi; if [ -e "$2" ] && [ -e "$3" ]; then printf :retained; else printf :removed; fi`,
      [pending, target]
    );
    assert.equal(stdout, 'refused:retained');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses to delete pending links when both content reads fail', async () => {
  const json = await pairFixture('baci-recovery-json-digest-failure-');
  const digest = await pairFixture('baci-recovery-digest-failure-');
  try {
    const { stdout } = await shell(
      `id() { printf '1000\\n'; }; stat() { case "$2" in %a) printf '600\\n';; %d:%i) printf '1:1\\n';; *) return 1;; esac; }; fsync_dir() { :; }; recovery_json_digest() { return 1; }; if recovery_reconcile_duplicate_link "$2" "$3"; then printf json-deleted; else printf json-refused; fi; recovery_read_digest() { return 1; }; if recovery_reconcile_digest_link "$4" "$5"; then printf :digest-deleted; else printf :digest-refused; fi; if [ -e "$2" ] && [ -e "$3" ] && [ -e "$4" ] && [ -e "$5" ]; then printf :retained; else printf :removed; fi`,
      [json.pending, json.target, digest.pending, digest.target]
    );
    assert.equal(stdout, 'json-refused:digest-refused:retained');
  } finally {
    await Promise.all([
      rm(json.directory, { recursive: true, force: true }),
      rm(digest.directory, { recursive: true, force: true }),
    ]);
  }
});

test('refuses pending-pair recovery when either paired digest cannot be read', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-pending-pair-')
  );
  const json = join(directory, 'recovery-scan.json');
  const digest = `${json}.sha256`;
  const digestPending = `${digest}.pending`;
  await Promise.all([
    writeFile(json, '{}'),
    writeFile(digest, 'a'.repeat(64)),
    writeFile(digestPending, 'a'.repeat(64)),
  ]);
  try {
    await assert.rejects(
      shell(
        `recovery_reconcile_publish_temporaries() { :; }; recovery_validate_json() { :; }; recovery_pair_digest() { :; }; recovery_safe_receipt_file() { :; }; reads=0; recovery_read_digest() { reads=$((reads + 1)); [ "$reads" -eq 1 ] && printf '%064d\\n' 0 || return 1; }; recovery_no_pending() { :; }; recovery_reconcile_pair "$2"`,
        [directory]
      ),
      (error) => error.code === 78 && /pending digest drift/.test(error.stderr)
    );
    assert.equal(await readFile(digestPending, 'utf8'), 'a'.repeat(64));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('syncs the receipt directory after removing an accepted pending digest', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-pending-sync-')
  );
  const json = join(directory, 'recovery-scan.json');
  const digest = `${json}.sha256`;
  const digestPending = `${digest}.pending`;
  await Promise.all([
    writeFile(json, '{}'),
    writeFile(digest, 'a'.repeat(64)),
    writeFile(digestPending, 'a'.repeat(64)),
  ]);
  try {
    const { stdout } = await shell(
      `expected=$2; recovery_reconcile_publish_temporaries() { :; }; recovery_validate_json() { :; }; recovery_pair_digest() { :; }; recovery_read_digest() { printf '%064d\\n' 0; }; recovery_no_pending() { :; }; synced=0; fsync_dir() { [ "$1" = "$expected" ] || return 1; synced=$((synced + 1)); if [ "$synced" -eq 1 ]; then [ -e "$expected/recovery-scan.json.sha256.pending" ]; else [ ! -e "$expected/recovery-scan.json.sha256.pending" ]; fi; }; recovery_reconcile_pair "$expected"; printf 'synced:%s\\n' "$synced"`,
      [directory]
    );
    assert.equal(stdout, 'synced:2\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses recovery when an accepted pending digest cannot be removed', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-pending-remove-')
  );
  const json = join(directory, 'recovery-scan.json');
  const digest = `${json}.sha256`;
  const digestPending = `${digest}.pending`;
  await Promise.all([
    writeFile(json, '{}'),
    writeFile(digest, 'a'.repeat(64)),
    writeFile(digestPending, 'a'.repeat(64)),
  ]);
  await chmod(directory, 0o555);
  try {
    const options = unprivilegedChildOptions();
    const uid = options.uid ?? process.getuid();
    const gid = options.gid ?? process.getgid();
    await assert.rejects(
      shell(
        `[ "$(/usr/bin/id -u)" = "$3" ] && [ "$(/usr/bin/id -g)" = "$4" ] && [ "$3" -ne 0 ] || exit 97; recovery_reconcile_publish_temporaries() { :; }; recovery_validate_json() { :; }; recovery_pair_digest() { :; }; recovery_read_digest() { printf '%064d\\n' 0; }; recovery_no_pending() { :; }; fsync_dir() { :; }; recovery_reconcile_pair "$2"`,
        [directory, String(uid), String(gid)],
        options
      ),
      (error) =>
        error.code === 78 &&
        /recovery pending digest cleanup failed/.test(error.stderr)
    );
  } finally {
    await chmod(directory, 0o700);
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses publication when a partial receipt digest comparison cannot be proven', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-partial-pair-')
  );
  const json = join(directory, 'recovery-scan.json');
  const digest = `${json}.sha256`;
  const digestPending = `${digest}.pending`;
  await Promise.all([
    writeFile(json, '{}'),
    writeFile(digestPending, 'a'.repeat(64)),
  ]);
  try {
    await assert.rejects(
      shell(
        `recovery_reconcile_publish_temporaries() { :; }; recovery_validate_json() { :; }; recovery_pair_digest() { :; }; recovery_safe_receipt_file() { :; }; recovery_read_digest() { return 1; }; recovery_json_digest() { return 1; }; recovery_publish_link() { printf published; }; recovery_no_pending() { :; }; recovery_reconcile_pair "$2"`,
        [directory]
      ),
      (error) =>
        error.code === 78 &&
        /digest pending drift/.test(error.stderr) &&
        !error.stdout.includes('published')
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses JSON publication when the pending JSON and digest cannot be proven equal', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-json-pending-')
  );
  const json = join(directory, 'recovery-scan.json');
  const digest = `${json}.sha256`;
  const jsonPending = `${json}.pending`;
  await Promise.all([
    writeFile(digest, 'a'.repeat(64)),
    writeFile(jsonPending, '{}'),
  ]);
  try {
    await assert.rejects(
      shell(
        `recovery_reconcile_publish_temporaries() { :; }; recovery_validate_json() { :; }; recovery_pair_digest() { :; }; recovery_safe_receipt_file() { :; }; reads=0; recovery_read_digest() { reads=$((reads + 1)); [ "$reads" -eq 1 ] && printf '%064d\\n' 0 || return 1; }; recovery_json_digest() { return 1; }; recovery_publish_link() { printf published; }; recovery_no_pending() { :; }; recovery_reconcile_pair "$2"`,
        [directory]
      ),
      (error) =>
        error.code === 78 &&
        /JSON pending drift/.test(error.stderr) &&
        !error.stdout.includes('published')
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps pending evidence when target fsync fails during publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-fsync-file-'));
  const pending = join(directory, 'pending');
  const target = join(directory, 'target');
  await writeFile(pending, '{}');
  await chmod(pending, 0o600);
  try {
    const { stdout } = await shell(
      `recovery_safe_receipt_file() { :; }; recovery_safe_receipt_ancestry() { :; }; fsync_file() { return 1; }; fsync_dir() { :; }; if recovery_publish_link "$2" "$3"; then printf published; else printf refused; fi; [ -e "$2" ] && [ -e "$3" ] && printf :retained`,
      [pending, target]
    );
    assert.equal(stdout, 'refused:retained');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps pending evidence when directory fsync fails before publication cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-fsync-dir-'));
  const pending = join(directory, 'pending');
  const target = join(directory, 'target');
  await writeFile(pending, '{}');
  await chmod(pending, 0o600);
  try {
    const { stdout } = await shell(
      `recovery_safe_receipt_file() { :; }; recovery_safe_receipt_ancestry() { :; }; fsync_file() { :; }; fsync_dir() { return 1; }; if recovery_publish_link "$2" "$3"; then printf published; else printf refused; fi; [ -e "$2" ] && [ -e "$3" ] && printf :retained`,
      [pending, target]
    );
    assert.equal(stdout, 'refused:retained');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps accepted pending digest when reconciliation fsync fails', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-reconcile-fsync-')
  );
  const json = join(directory, 'recovery-scan.json');
  const digest = `${json}.sha256`;
  const digestPending = `${digest}.pending`;
  await Promise.all([
    writeFile(json, '{}'),
    writeFile(digest, 'a'.repeat(64)),
    writeFile(digestPending, 'a'.repeat(64)),
  ]);
  try {
    await assert.rejects(
      shell(
        `recovery_reconcile_publish_temporaries() { :; }; recovery_validate_json() { :; }; recovery_pair_digest() { :; }; recovery_read_digest() { printf '%064d\\n' 0; }; recovery_no_pending() { :; }; fsync_dir() { return 1; }; recovery_reconcile_pair "$2"`,
        [directory]
      ),
      (error) =>
        error.code === 78 && /pending digest cleanup failed/.test(error.stderr)
    );
    assert.equal(await readFile(digestPending, 'utf8'), 'a'.repeat(64));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
