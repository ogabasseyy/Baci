import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('terminal recovery revalidates the reviewed bassey crontab without losing its expected snapshot path', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-terminal-crontab-')
  );
  const expectedSnapshot = join(directory, 'expected.json');
  const basseyCrontab = join(directory, 'bassey');

  try {
    await writeFile(expectedSnapshot, '{"inventory":"stable"}\n');
    await writeFile(
      basseyCrontab,
      '17 3 * * * /srv/baci/scripts/reviewed-maintenance.sh\n'
    );

    const { stdout } = await execFileAsync('sh', [
      '-c',
      `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"
SCRIPT_DIR=$(dirname "$1")
. "$SCRIPT_DIR/retire-ollama-recovery.sh"
. "$SCRIPT_DIR/retire-ollama-cron-inventory.sh"
init_temp_root
trap cleanup_temp EXIT
expected_snapshot=$2
bassey_crontab=$3
cron_inventory_real_file() { [ "$1" = "$bassey_crontab" ]; }
cron_inventory_account_uid() { [ "$1" = bassey ] || return 1; printf '%s\\n' 1000; }
stat() { [ "$3" = "$bassey_crontab" ] || return 1; printf '%s\\n' 1000:600; }
recovery_collect_mutable_consumers() {
  terminal_cron=$1
  terminal_snapshot=$2
  cron_inventory_user_file_ok bassey "$bassey_crontab" || review_required 'reviewed bassey crontab refused'
  : >"$terminal_cron"
  cp "$expected_snapshot" "$terminal_snapshot"
  RECOVERY_EXTERNAL_CRON_SOURCES=$(temp_path)
  : >"$RECOVERY_EXTERNAL_CRON_SOURCES"
}
RECOVERY_RECORDS='[]'
deps='[]'
consumer_counts='[]'
consumer_evidence='[]'
recovery_terminal_mutable_consumers "$expected_snapshot"
printf '%s\\n' ok`,
      'retire-ollama-recovery-terminal-crontab-test',
      script.pathname,
      expectedSnapshot,
      basseyCrontab,
    ]);

    assert.equal(stdout, 'ok\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
