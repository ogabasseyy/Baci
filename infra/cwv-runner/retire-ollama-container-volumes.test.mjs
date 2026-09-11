import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, chown, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};

async function volumeFiles(mode) {
  const directory = await mkdtemp(join(tmpdir(), 'baci-volume-bounds-'));
  const volume = join(directory, 'volume');
  await mkdir(volume);
  if (process.getuid?.() === 0) {
    await chown(directory, 65534, 65534);
    await chown(volume, 65534, 65534);
  }
  const shell = String.raw`
. "$1"
SCRIPT_DIR=$(dirname "$1")
RETIRE_OLLAMA_TMPDIR="$2"
init_temp_root
trap cleanup_temp EXIT
load_consumer_scanners
find() {
  case "$RETIRE_TEST_MODE" in
    entries) printf '%s\0' "$1"; /usr/bin/perl -e 'for (1..100000) { print $ENV{RETIRE_TEST_VOLUME} . "/file-" . $_ . "\0" } open my $f, ">", $ENV{RETIRE_TEST_PRODUCER_COMPLETE} or exit 3; print $f "complete\n";' ;;
    bytes) printf '%s\0%s/file-one\0%s/file-two\0' "$1" "$1" "$1" ;;
    empty) printf '%s\0%s/empty-file\0' "$1" "$1" ;;
    boundary) printf '%s\0%s/file-one\0' "$1" "$1" ;;
    *) return 2 ;;
  esac
}
readlink() { for value do :; done; printf '%s\n' "$value"; }
stat() {
  for value do :; done
  case "$*" in
    *"%d"*) printf '7\n' ;;
    *"%F"*) [ "$value" = "$RETIRE_TEST_VOLUME" ] && printf 'directory\n' || { [ "$RETIRE_TEST_MODE" = empty ] && printf 'regular empty file\n' || printf 'regular file\n'; } ;;
    *"%s"*) case "$RETIRE_TEST_MODE:$value" in bytes:*/file-one|boundary:*/file-one) printf '268435456\n';; bytes:*/file-two) printf '1\n';; *) printf '0\n';; esac ;;
    *) return 2 ;;
  esac
}
container_volume_files "$RETIRE_TEST_VOLUME"
`;
  try {
    const producerComplete = join(directory, 'producer-complete');
    try {
      return await execFileAsync(
        'sh',
        [
          '-c',
          shell,
          'retire-ollama-volume-bounds-test',
          script.pathname,
          directory,
        ],
        {
          ...unprivileged,
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
            RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
            RETIRE_TEST_MODE: mode,
            RETIRE_TEST_VOLUME: volume,
            RETIRE_TEST_PRODUCER_COMPLETE: producerComplete,
          },
        }
      );
    } catch (error) {
      if (mode === 'entries') await assert.rejects(access(producerComplete));
      throw error;
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test('fails closed above the bounded named-volume entry count', async () => {
  await assert.rejects(volumeFiles('entries'), (error) => error.code === 2);
});

test('fails closed above the bounded named-volume content bytes', async () => {
  await assert.rejects(volumeFiles('bytes'), (error) => error.code === 2);
});

test('accepts a named-volume snapshot exactly at the content bound', async () => {
  const { stdout, stderr } = await volumeFiles('boundary');
  assert.match(stdout, /\/file-one\n$/);
  assert.equal(stderr, '');
});

test('accepts zero-byte regular files reported as regular empty file', async () => {
  const { stdout, stderr } = await volumeFiles('empty');
  assert.match(stdout, /\/empty-file\n$/);
  assert.equal(stderr, '');
});
