import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
process.env.RETIRE_OLLAMA_TEST_BIN = '/sbin';
process.env.RETIRE_OLLAMA_TEST_FSTYPE = 'apfs';

test('records a generic cron wrapper whose target alone uses the Ollama endpoint', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-cron-wrapper-consumer-')
  );
  const cron = join(directory, 'crontab');
  const wrapper = join(directory, 'application-worker');
  const endpointLine = 'curl http://127.0.0.1:11434/api/tags';
  const wrapperBytes = `#!/bin/sh\n${endpointLine}\n`;
  try {
    await Promise.all([
      writeFile(cron, `* * * * * root ${wrapper}\n`),
      writeFile(wrapper, wrapperBytes),
    ]);
    await chmod(wrapper, 0o755);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      '. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; load_cron_inventory_helper; consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ] || return 2; printf "%s\\n" "$1"; }; consumer_snapshot() { snapshot=$(temp_path); cat "$1" >"$snapshot"; printf "%s|stable\\n" "$snapshot"; }; consumer_source_identity() { printf "stable\\n"; }; records="[]"; deps="[]"; consumer_counts="[]"; consumer_evidence="[]"; cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; printf "%s\\n%s\\n" "$records" "$consumer_counts"',
      'retire-ollama-cron-wrapper-consumers-test',
      script.pathname,
      cron,
    ]);
    const [records, counts] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(records, [
      {
        class: 'system-crontab-command',
        realPath: wrapper,
        sha256: createHash('sha256').update(wrapperBytes).digest('hex'),
        identitySha256: 'stable',
      },
    ]);
    assert.deepEqual(counts, [{ surface: 'system-crontab', matchCount: 1 }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('records a generic wrapper launched by an etc cron.d schedule', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-d-wrapper-'));
  const cronDirectory = join(directory, 'cron.d');
  const cron = join(cronDirectory, 'application-worker');
  const wrapper = join(directory, 'application-command');
  const wrapperBytes = '#!/bin/sh\ncurl http://127.0.0.1:11434/api/tags\n';
  try {
    await mkdir(cronDirectory);
    await Promise.all([
      writeFile(cron, `* * * * * root ${wrapper}\n`),
      writeFile(wrapper, wrapperBytes),
    ]);
    await chmod(wrapper, 0o755);
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        '. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; load_cron_inventory_helper; consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ] || return 2; printf "%s\\n" "$1"; }; consumer_snapshot() { snapshot=$(temp_path); cat "$1" >"$snapshot"; printf "%s|stable\\n" "$snapshot"; }; consumer_source_identity() { printf "stable\\n"; }; records="[]"; deps="[]"; consumer_counts="[]"; consumer_evidence="[]"; cron_inventory_record_wrapper_consumers system-cron-directory system-directory "$2" "$2"; printf "%s\\n" "$records"',
        'retire-ollama-cron-wrapper-consumers-test',
        script.pathname,
        cron,
      ],
      {
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
          RETIRE_OLLAMA_CRON_SYSTEM_DIR: cronDirectory,
        },
      }
    );
    assert.deepEqual(JSON.parse(stdout), [
      {
        class: 'system-cron-directory-command',
        realPath: wrapper,
        sha256: createHash('sha256').update(wrapperBytes).digest('hex'),
        identitySha256: 'stable',
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed when a direct cron command target cannot be resolved safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-wrapper-missing-'));
  const cron = join(directory, 'crontab');
  const missing = join(directory, 'missing-worker');
  try {
    await writeFile(cron, `* * * * * root ${missing}\n`);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      '. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; load_cron_inventory_helper; consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ] || return 2; printf "%s\\n" "$1"; }; records="[]"; if cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; then exit 1; else printf "%s\\n" "$?"; fi',
      'retire-ollama-cron-wrapper-consumers-test',
      script.pathname,
      cron,
    ]);
    assert.equal(stdout.trim(), '2');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed on a bare cron wrapper executable without arguments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-wrapper-bare-'));
  const cron = join(directory, 'crontab');
  const wrapper = join(directory, 'application-worker');
  try {
    await Promise.all([
      writeFile(cron, `* * * * * root ${wrapper}\n`),
      writeFile(wrapper, '#!/bin/sh\nworker\n'),
    ]);
    await chmod(wrapper, 0o755);

    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        '. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; sha256sum() { /usr/bin/shasum -a 256 "$@"; }; load_cron_inventory_helper; consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ] || return 2; printf "%s\\n" "$1"; }; consumer_snapshot() { snapshot=$(temp_path); cat "$1" >"$snapshot"; printf "%s|stable\\n" "$snapshot"; }; consumer_source_identity() { printf "stable\\n"; }; records="[]"; deps="[]"; consumer_counts="[]"; consumer_evidence="[]"; cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"',
        'retire-ollama-cron-wrapper-bare-test',
        script.pathname,
        cron,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('skips the canonical root run-parts delegation after periodic binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-run-parts-'));
  const cron = join(directory, 'crontab');
  const hourly = join(directory, 'cron.hourly');
  const daily = join(directory, 'cron.daily');
  try {
    await Promise.all([mkdir(hourly), mkdir(daily)]);
    await writeFile(
      cron,
      `17 * * * * root cd / && run-parts --report ${hourly}\n25 6 * * * root test -x /usr/sbin/anacron || ( cd / && run-parts --report ${daily} )\n`
    );
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        '. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; load_cron_inventory_helper; records="[]"; cron_inventory_record_wrapper_consumers system-crontab system "$2" "$2"; printf "%s\\n" "$records"',
        'retire-ollama-cron-wrapper-consumers-test',
        script.pathname,
        cron,
      ],
      {
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
          RETIRE_OLLAMA_CRON_SYSTEM_FILE: cron,
          RETIRE_OLLAMA_CRON_HOURLY_DIR: hourly,
          RETIRE_OLLAMA_CRON_DAILY_DIR: daily,
        },
      }
    );
    assert.equal(stdout.trim(), '[]');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not accept an arbitrary shell compound as periodic delegation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cron-run-parts-other-'));
  const cron = join(directory, 'crontab');
  try {
    await writeFile(
      cron,
      '17 * * * * root cd / && run-parts --report /opt/not-a-bound-periodic-dir\n'
    );
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        '. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; load_cron_inventory_helper; if cron_inventory_command_targets system "$2" "$2"; then exit 1; else printf "%s\\n" "$?"; fi',
        'retire-ollama-cron-wrapper-consumers-test',
        script.pathname,
        cron,
      ],
      {
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
          RETIRE_OLLAMA_CRON_SYSTEM_FILE: cron,
        },
      }
    );
    assert.equal(stdout.trim(), '2');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
