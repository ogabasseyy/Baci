import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const scanner = join(here, 'retire-ollama.sh');

test('fails before hashing when a consumer grows beyond the snapshot byte bound', async () => {
  const root = await mkdtemp(join(tmpdir(), 'retire-ollama-snapshot-bound-'));
  const consumer = join(root, 'consumer.conf');
  const counter = join(root, 'stat-count');
  const marker = join(root, 'unbounded-read');
  await writeFile(consumer, 'host = 127.0.0.1:11434\n');
  await writeFile(counter, '0\n');

  const script = `
. "$1"
SCRIPT_DIR=$(dirname "$1")
load_consumer_scanners
test_root=$2
test_consumer=$4
test_counter=$5
test_marker=$6
temp_path() { mktemp "$test_root/snapshot.XXXXXX"; }
real_stat=$(command -v stat)
stat() {
  if [ "$1" = -c ] && [ "$2" = %d:%i:%f:%s:%u:%g:%a ] && [ "$3" = "$test_consumer" ]; then
    count=$(/bin/cat "$test_counter") || return 2
    count=$((count + 1))
    printf '%s\\n' "$count" >"$test_counter" || return 2
    [ "$count" -eq 1 ] && printf '1:2:81a4:24:0:0:600\\n' || printf '1:2:81a4:67108865:0:0:600\\n'
    return
  fi
  "$real_stat" "$@"
}
sha() { : >"$test_marker"; return 2; }
set +e
consumer_snapshot "$test_consumer" >/dev/null
status=$?
set -e
[ "$status" -eq 2 ] || exit 1
[ ! -e "$test_marker" ] || exit 2
`;

  try {
    const result = await execFileAsync('sh', [
      '-c',
      script,
      'consumer-snapshot-growth-test',
      scanner,
      root,
      root,
      consumer,
      counter,
      marker,
    ]);
    assert.equal(result.stderr, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
