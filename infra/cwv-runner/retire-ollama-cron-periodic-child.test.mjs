import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const harness =
  'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; ' +
  '. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; load_cron_inventory_helper; consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ] || return 2; printf "%s\\n" "$1"; }; consumer_snapshot() { snapshot=$(temp_path); cat "$1" >"$snapshot"; printf "%s|stable\\n" "$snapshot"; }; consumer_source_identity() { printf "stable\\n"; }; records="[]"; deps="[]"; consumer_counts="[]"; consumer_evidence="[]"';

test('binds a generic child launched by a fixed periodic cron script', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-periodic-child-'));
  const hourly = join(directory, 'cron.hourly');
  const periodic = join(hourly, 'application');
  const worker = join(directory, 'application-worker');
  try {
    await chmod(directory, 0o777);
    await mkdir(hourly);
    await Promise.all([
      writeFile(periodic, `#!/bin/sh\n${worker}\n`),
      writeFile(worker, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
    ]);
    await Promise.all([chmod(periodic, 0o755), chmod(worker, 0o755)]);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `${harness}; RETIRE_OLLAMA_TEST_BIN=/usr/bin; RETIRE_OLLAMA_CRON_SYSTEM_DIR=/not-cron-d; RETIRE_OLLAMA_CRON_HOURLY_DIR="$3"; RETIRE_OLLAMA_CRON_DAILY_DIR=/not-daily; RETIRE_OLLAMA_CRON_WEEKLY_DIR=/not-weekly; RETIRE_OLLAMA_CRON_MONTHLY_DIR=/not-monthly; cron_inventory_record_wrapper_consumers system-cron-directory system-directory "$2" "$2"; printf "%s\\n%s\\n" "$records" "$consumer_counts"`,
        'retire-ollama-cron-periodic-child-test',
        script.pathname,
        periodic,
        hourly,
      ],
      unprivileged
    );
    const [records, counts] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      records.map(({ realPath }) => realPath),
      [periodic, worker]
    );
    assert.deepEqual(
      counts.map(({ matchCount }) => matchCount),
      [0, 1]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
