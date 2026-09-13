import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('exempts only the reviewed service process when argv is duplicated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-service-process-'));
  const processes = join(directory, 'processes');
  try {
    await writeFile(
      processes,
      '41 1 ollama /usr/bin/ollama serve\n42 1 ollama /usr/bin/ollama serve\n'
    );
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; init_temp_root; trap cleanup_temp EXIT; APPROVED_OLLAMA_PID=41; APPROVED_OLLAMA_PROCESS_IDENTITY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; record_consumers running-processes "$2"; printf '%s\n' "$consumer_counts"`,
      'retire-ollama-service-process-binding-test',
      script.pathname,
      processes,
    ]);
    assert.deepEqual(JSON.parse(stdout), [
      { surface: 'running-processes', matchCount: 1 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses a replaced loaded unit before stop or disable mutates it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-unit-rebind-'));
  const receipt = join(directory, 'receipt.json');
  const before = join(directory, 'before.json');
  const replacement = join(directory, 'replacement.json');
  const mutations = join(directory, 'mutations');
  const scan = (fragment) => ({
    container: {},
    cronSha256: 'cron',
    model: {},
    records: [{ class: 'systemd-fragments', sha256: fragment }],
    units: [],
  });
  await Promise.all([
    writeFile(receipt, JSON.stringify({ scan: scan('reviewed-fragment') })),
    writeFile(before, JSON.stringify(scan('reviewed-fragment'))),
    writeFile(replacement, JSON.stringify(scan('unrelated-fragment'))),
  ]);
  try {
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; init_temp_root; trap cleanup_temp EXIT; RECEIPT=$2; CURRENT=$3; MUTATIONS=$5
collect() { cp "$CURRENT" "$1"; }
systemctl() { case "$1" in stop|disable) printf '%s\n' "$*" >>"$MUTATIONS";; is-active|is-enabled) return 1;; *) return 64;; esac; }
revalidate_before disable_unit
CURRENT=$4
disable_unit`,
        'retire-ollama-unit-rebind-test',
        script.pathname,
        receipt,
        before,
        replacement,
        mutations,
      ]),
      (error) =>
        error.code === 65 && /drift before disable_unit/.test(error.stderr)
    );
    await assert.rejects(
      readFile(mutations),
      (error) => error.code === 'ENOENT'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
