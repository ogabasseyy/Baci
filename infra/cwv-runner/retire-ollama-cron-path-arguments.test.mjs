import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const harness =
  'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; load_cron_inventory_helper; consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ] || return 2; printf "%s\\n" "$1"; }; consumer_snapshot() { snapshot=$(temp_path); cat "$1" >"$snapshot"; printf "%s|stable\\n" "$snapshot"; }; consumer_source_identity() { printf "stable\\n"; }; records="[]"; deps="[]"; consumer_counts="[]"; consumer_evidence="[]"';

test('binds an absolute file in a wrapper option value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-option-path-'));
  const cron = join(directory, 'crontab');
  const wrapper = join(directory, 'cron-wrapper');
  const worker = join(directory, 'application-worker');
  const configuration = join(directory, 'application.conf');
  try {
    await Promise.all([
      writeFile(cron, `* * * * * root ${wrapper}\n`),
      writeFile(wrapper, `#!/bin/sh\n${worker} --config=${configuration}\n`),
      writeFile(worker, '#!/bin/sh\nexit 0\n'),
      writeFile(configuration, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
    ]);
    await Promise.all([chmod(wrapper, 0o755), chmod(worker, 0o755)]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${harness}; cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; printf "%s\\n%s\\n" "$records" "$consumer_counts"`,
      'retire-ollama-cron-option-path-test',
      script.pathname,
      cron,
    ]);
    const [records, counts] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      records.map(({ realPath }) => realPath),
      [wrapper, worker, configuration]
    );
    assert.deepEqual(
      counts.map(({ matchCount }) => matchCount),
      [0, 0, 1]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('binds an absolute file in a single-dash option value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-short-option-'));
  const cron = join(directory, 'crontab');
  const wrapper = join(directory, 'cron-wrapper');
  const worker = join(directory, 'application-worker');
  const configuration = join(directory, 'application.conf');
  try {
    await Promise.all([
      writeFile(cron, `* * * * * root ${wrapper}\n`),
      writeFile(wrapper, `#!/bin/sh\n${worker} -c=${configuration}\n`),
      writeFile(worker, '#!/bin/sh\nexit 0\n'),
      writeFile(configuration, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
    ]);
    await Promise.all([chmod(wrapper, 0o755), chmod(worker, 0o755)]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${harness}; cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; printf "%s\\n%s\\n" "$records" "$consumer_counts"`,
      'retire-ollama-cron-short-option-test',
      script.pathname,
      cron,
    ]);
    const [records, counts] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      records.map(({ realPath }) => realPath),
      [wrapper, worker, configuration]
    );
    assert.deepEqual(
      counts.map(({ matchCount }) => matchCount),
      [0, 0, 1]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [label, option] of [
  ['dynamic', '-c="$CONFIG"'],
  ['unsafe', '-c=/tmp/../application.conf'],
]) {
  test(`fails closed on a ${label} single-dash option value`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), `baci-cron-${label}-short-option-`)
    );
    const cron = join(directory, 'crontab');
    const wrapper = join(directory, 'cron-wrapper');
    const worker = join(directory, 'application-worker');
    try {
      await Promise.all([
        writeFile(cron, `* * * * * root ${wrapper}\n`),
        writeFile(wrapper, `#!/bin/sh\n${worker} ${option}\n`),
        writeFile(worker, '#!/bin/sh\nexit 0\n'),
      ]);
      await Promise.all([chmod(wrapper, 0o755), chmod(worker, 0o755)]);
      const { stdout } = await execFileAsync('sh', [
        '-c',
        `${harness}; if cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; then printf "0\\n"; else printf "%s\\n" "$?"; fi`,
        `retire-ollama-cron-${label}-short-option-test`,
        script.pathname,
        cron,
      ]);
      assert.equal(stdout.trim(), '2');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('fails closed on a relative child behind a cd compound', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-relative-child-'));
  const cron = join(directory, 'crontab');
  const wrapper = join(directory, 'cron-wrapper');
  try {
    await Promise.all([
      writeFile(cron, `* * * * * root ${wrapper}\n`),
      writeFile(
        wrapper,
        `#!/bin/sh\ncd ${directory} && ./application-worker\n`
      ),
    ]);
    await chmod(wrapper, 0o755);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${harness}; if cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; then printf "0\\n"; else printf "%s\\n" "$?"; fi`,
      'retire-ollama-cron-relative-child-test',
      script.pathname,
      cron,
    ]);
    assert.equal(stdout.trim(), '2');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('binds a direct cron command absolute file argument', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-direct-argument-'));
  const cron = join(directory, 'crontab');
  const worker = join(directory, 'application-worker');
  const configuration = join(directory, 'application.conf');
  try {
    await Promise.all([
      writeFile(cron, `* * * * * root ${worker} --config ${configuration}\n`),
      writeFile(worker, '#!/bin/sh\nexit 0\n'),
      writeFile(configuration, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
    ]);
    await chmod(worker, 0o755);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${harness}; cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; printf "%s\\n%s\\n" "$records" "$consumer_counts"`,
      'retire-ollama-cron-direct-argument-test',
      script.pathname,
      cron,
    ]);
    const [records, counts] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      records.map(({ realPath }) => realPath),
      [worker, configuration]
    );
    assert.deepEqual(
      counts.map(({ matchCount }) => matchCount),
      [0, 1]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('binds absolute file arguments trailing an exact flock launcher', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-flock-argument-'));
  const cron = join(directory, 'crontab');
  const worker = join(directory, 'application-worker');
  const configuration = join(directory, 'application.conf');
  try {
    await Promise.all([
      writeFile(
        cron,
        `* * * * * root /usr/bin/flock -n /run/application.lock ${worker} --config ${configuration}\n`
      ),
      writeFile(worker, '#!/bin/sh\nexit 0\n'),
      writeFile(configuration, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
    ]);
    await chmod(worker, 0o755);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `${harness}; cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; printf "%s\\n%s\\n" "$records" "$consumer_counts"`,
      'retire-ollama-cron-flock-argument-test',
      script.pathname,
      cron,
    ]);
    const [records, counts] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      records.map(({ realPath }) => realPath),
      [worker, configuration]
    );
    assert.deepEqual(
      counts.map(({ matchCount }) => matchCount),
      [0, 1]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
