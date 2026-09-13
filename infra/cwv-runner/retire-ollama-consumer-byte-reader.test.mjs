import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const LIMIT = 67_108_864;

test('aborts a single-file copy while reading once it exceeds the byte bound', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-consumer-byte-reader-'));
  const source = join(root, 'source');
  const destination = join(root, 'destination');
  await writeFile(source, Buffer.alloc(LIMIT + 1, 65));
  await writeFile(destination, '');
  const command = `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; CONSUMER_SNAPSHOT_MAX_BYTES=$2; if consumer_copy_bounded "$3" "$4"; then status=0; else status=$?; fi; [ "$status" -eq 2 ] || exit 1; if consumer_hash_bounded "$3" >/dev/null; then hash_status=0; else hash_status=$?; fi; [ "$hash_status" -eq 2 ] || exit 2; bytes=$(wc -c <"$4" | tr -d ' '); [ "$bytes" -le "$2" ] || exit 3`;
  try {
    await execFileAsync('sh', [
      '-c',
      command,
      'consumer-byte-reader-test',
      script.pathname,
      LIMIT,
      source,
      destination,
    ]);
    assert.equal((await stat(destination)).size <= LIMIT, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('rejects non-regular opened handles before hashing or copying', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-consumer-handle-type-'));
  const destination = join(root, 'destination');
  await writeFile(destination, 'unchanged');
  const command = `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; consumer_hash_bounded /dev/null >/dev/null 2>&1 && exit 1; [ "$?" -eq 2 ] || exit 2; consumer_copy_bounded /dev/null "$2" >/dev/null 2>&1 && exit 3; [ "$?" -eq 2 ]`;
  try {
    await execFileAsync('sh', [
      '-c',
      command,
      'consumer-handle-type-test',
      script.pathname,
      destination,
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
