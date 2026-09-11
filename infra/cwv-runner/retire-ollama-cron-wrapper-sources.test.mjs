import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

const harness = [
  'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"',
  'SCRIPT_DIR=$(dirname "$1")',
  'init_temp_root',
  'trap cleanup_temp EXIT',
  'sha256sum() { /usr/bin/shasum -a 256 "$@"; }',
  'load_cron_inventory_helper',
  'consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ] || return 2; printf "%s\\n" "$1"; }',
  'consumer_snapshot() { snapshot=$(temp_path); cat "$1" >"$snapshot"; printf "%s|stable\\n" "$snapshot"; }',
  'consumer_source_identity() { printf "stable\\n"; }',
  'records="[]"',
  'deps="[]"',
  'consumer_counts="[]"',
  'consumer_evidence="[]"',
].join('; ');

test('binds recursive cron wrapper sources once when the source graph cycles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-sources-'));
  const cron = join(directory, 'crontab');
  const wrapper = join(directory, 'worker');
  const middle = join(directory, 'environment-loader');
  const configuration = join(directory, 'application.conf');
  try {
    await Promise.all([
      writeFile(cron, `* * * * * root ${wrapper}\n`),
      writeFile(wrapper, `#!/bin/sh\n. ${middle}\n`),
      writeFile(middle, `. ${wrapper}\n. ${configuration}\n`),
      writeFile(configuration, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
    ]);
    await chmod(wrapper, 0o755);

    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${harness}; cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; jq -cn --argjson records "$records" --argjson counts "$consumer_counts" --argjson deps "$deps" '{records:$records,counts:$counts,deps:$deps}'`,
      'retire-ollama-cron-wrapper-sources-test',
      script.pathname,
      cron,
    ]);
    const result = JSON.parse(stdout);

    assert.deepEqual(
      result.records.map(({ realPath }) => realPath),
      [wrapper, middle, configuration]
    );
    assert.deepEqual(
      result.counts.map(({ matchCount }) => matchCount),
      [0, 0, 1]
    );
    assert.equal(result.deps.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed when a cron wrapper uses a dynamic source expression', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-dynamic-source-'));
  const cron = join(directory, 'crontab');
  const wrapper = join(directory, 'worker');
  try {
    await Promise.all([
      writeFile(cron, `* * * * * root ${wrapper}\n`),
      writeFile(wrapper, '#!/bin/sh\n. "$APPLICATION_CONFIG"\n'),
    ]);
    await chmod(wrapper, 0o755);

    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${harness}; if cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; then printf '0\\n'; else printf '%s\\n' "$?"; fi`,
      'retire-ollama-cron-wrapper-sources-test',
      script.pathname,
      cron,
    ]);

    assert.equal(stdout.trim(), '2');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
