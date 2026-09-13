import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chown, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const fixtureHelpers = [
  'retire-ollama.sh',
  'retire-ollama-consumer-closure.sh',
  'retire-ollama-consumers.sh',
  'retire-ollama-container-mounts.sh',
  'retire-ollama-projector-auth.sh',
  'retire-ollama-running-archive.sh',
  'retire-ollama-running-container.sh',
  'retire-ollama-running-container-validation.sh',
  'retire-ollama-temp-root.sh',
];
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};

async function inventory(mode, limits = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'baci-container-inventory-'));
  try {
    await Promise.all(
      fixtureHelpers.map((name) =>
        copyFile(new URL(`./${name}`, import.meta.url), join(directory, name))
      )
    );
    if (unprivileged.uid !== undefined && unprivileged.gid !== undefined) {
      await chown(directory, unprivileged.uid, unprivileged.gid);
    }
    const shell = String.raw`
. "$1"
SCRIPT_DIR=$(dirname "$1")
RETIRE_OLLAMA_TMPDIR="$2"
init_temp_root
trap cleanup_temp EXIT
load_consumer_scanners
[ -z "$RETIRE_TEST_MAX_ENTRIES" ] || CONTAINER_INVENTORY_MAX_ENTRIES=$RETIRE_TEST_MAX_ENTRIES
[ -z "$RETIRE_TEST_MAX_BYTES" ] || CONTAINER_INVENTORY_MAX_BYTES=$RETIRE_TEST_MAX_BYTES
CANONICAL_DOCKER_SOCKET=/run/docker.sock
  docker() {
    case "$RETIRE_TEST_MODE" in
    invalid) printf '%s\n' '../not-a-container-id' ;;
    legacy) printf '%s\n' 'generic-api' ;;
    valid) printf '%s\n' '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' ;;
    limit) printf '%064d\n%064d\n' 1 2 ;;
    bytes) printf '%064d\n' 1 ;;
    storm) /usr/bin/perl -e 'print "a" x 64, "\n" for 1..4097' ;;
    *) return 2 ;;
  esac
}
output=$(temp_path)
container_inventory all "$output"
cat "$output"
`;
    return await execFileAsync(
      'sh',
      [
        '-c',
        shell,
        'container-inventory-test',
        join(directory, 'retire-ollama.sh'),
        directory,
      ],
      {
        ...unprivileged,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
          RETIRE_OLLAMA_TEST_CONTAINER_IDS: '',
          RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
          RETIRE_TEST_MODE: mode,
          RETIRE_TEST_MAX_ENTRIES: limits.maxEntries ?? '',
          RETIRE_TEST_MAX_BYTES: limits.maxBytes ?? '',
        },
      }
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test('rejects a malformed raw container inventory before any inspect can occur', async () => {
  await assert.rejects(inventory('invalid'), (error) => error.code === 2);
});

test('accepts a valid full-length hexadecimal container ID', async () => {
  const { stdout } = await inventory('valid');
  assert.match(
    stdout,
    /^0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n$/
  );
});

test('keeps ordinary unprivileged test-bin callers on strict IDs', async () => {
  await assert.rejects(inventory('legacy'), (error) => error.code === 2);
});

test('rejects a bounded container inventory storm before inspect', async () => {
  await assert.rejects(inventory('storm'), (error) => error.code === 2);
});

test('enforces the configured container inventory entry limit', async () => {
  await assert.rejects(
    inventory('limit', { maxEntries: '1' }),
    (error) => error.code === 2
  );
});

test('enforces the configured container inventory byte limit', async () => {
  await assert.rejects(
    inventory('bytes', { maxBytes: '64' }),
    (error) => error.code === 2
  );
});

assert.ok(script.pathname.endsWith('retire-ollama.sh'));
