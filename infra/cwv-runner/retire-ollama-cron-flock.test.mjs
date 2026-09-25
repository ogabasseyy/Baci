import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('records the worker behind an exact nonblocking flock cron launcher', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-flock-'));
  const cron = join(directory, 'crontab');
  const flock = join(directory, 'flock');
  const worker = join(directory, 'application-worker');
  const workerBytes = '#!/bin/sh\ncurl http://127.0.0.1:11434/api/tags\n';
  try {
    await Promise.all([
      writeFile(
        cron,
        `* * * * * root /usr/bin/flock -n /run/application.lock ${worker}\n`
      ),
      writeFile(flock, '#!/bin/sh\nexit 0\n'),
      writeFile(worker, workerBytes),
    ]);
    await Promise.all([chmod(flock, 0o755), chmod(worker, 0o755)]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; sha256sum() { if [ -x /usr/bin/sha256sum ]; then /usr/bin/sha256sum "$@"; elif [ -x /bin/sha256sum ]; then /bin/sha256sum "$@"; elif [ -x /usr/bin/shasum ]; then /usr/bin/shasum -a 256 "$@"; else return 2; fi; }; load_cron_inventory_helper; fixture_flock="$3"; consumer_canonical_regular() { case "$1" in /usr/bin/flock) printf "%s\\n" "$fixture_flock";; *) [ -f "$1" ] && [ ! -L "$1" ] || return 2; printf "%s\\n" "$1";; esac; }; consumer_snapshot() { snapshot=$(temp_path); cat "$1" >"$snapshot"; printf "%s|stable\\n" "$snapshot"; }; consumer_source_identity() { printf "stable\\n"; }; records="[]"; deps="[]"; consumer_counts="[]"; consumer_evidence="[]"; cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; printf "%s\\n%s\\n" "$records" "$consumer_counts"',
      'retire-ollama-cron-flock-test',
      script.pathname,
      cron,
      flock,
    ]);
    const [records, counts] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(records, [
      {
        class: 'system-crontab-command',
        realPath: worker,
        sha256: createHash('sha256').update(workerBytes).digest('hex'),
        identitySha256: 'stable',
      },
    ]);
    assert.deepEqual(counts, [{ surface: 'system-crontab', matchCount: 1 }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed on an unsupported flock command-string form', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-flock-command-'));
  const cron = join(directory, 'crontab');
  try {
    await writeFile(
      cron,
      '* * * * * root /usr/bin/flock -n /run/application.lock -c /opt/application-worker\n'
    );
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; load_cron_inventory_helper; if cron_inventory_command_targets system "$2" "$2"; then exit 1; else printf "%s\\n" "$?"; fi',
      'retire-ollama-cron-flock-command-test',
      script.pathname,
      cron,
    ]);
    assert.equal(stdout.trim(), '2');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
