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

test('classifies uppercase Ollama crontab variables without changing evidence bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-ollama-crontab-'));
  const cron = join(directory, 'cron');
  const line = 'OLLAMA_HOST=http://127.0.0.1:8080';
  try {
    await writeFile(
      cron,
      `${line}\n0 * * * * /usr/bin/ollama serve\n0 * * * * /usr/bin/other\n`
    );
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; init_temp_root; trap cleanup_temp EXIT; OLLAMA_CRON_ONE=$(hash_text "$3"); deps="[]"; consumer_counts="[]"; consumer_evidence="[]"; record_consumers current-crontab "$2" cron; printf "%s\\n%s\\n" "$consumer_counts" "$consumer_evidence"',
      'retire-ollama-crontab-consumers-test',
      script.pathname,
      cron,
      '0 * * * * /usr/bin/ollama serve',
    ]);
    const [counts, evidence] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(counts, [{ surface: 'current-crontab', matchCount: 1 }]);
    assert.deepEqual(evidence, [
      {
        surface: 'current-crontab',
        classifiedPathSha256: createHash('sha256').update(line).digest('hex'),
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps compound ollama serve cron consumers while exempting only a reviewed line', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-crontab-compound-')
  );
  const cron = join(directory, 'cron');
  const approved = '0 * * * * /usr/bin/ollama serve';
  const compound = '0 * * * * /usr/bin/ollama serve & /opt/worker';
  try {
    await writeFile(cron, `${approved}\n${compound}\n`);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; init_temp_root; trap cleanup_temp EXIT; OLLAMA_CRON_ONE=$(hash_text "$3"); deps="[]"; consumer_counts="[]"; consumer_evidence="[]"; record_consumers current-crontab "$2" cron; printf "%s\\n%s\\n" "$consumer_counts" "$consumer_evidence"',
      'retire-ollama-crontab-consumers-test',
      script.pathname,
      cron,
      approved,
    ]);
    const [counts, evidence] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(counts, [{ surface: 'current-crontab', matchCount: 1 }]);
    assert.deepEqual(evidence, [
      {
        surface: 'current-crontab',
        classifiedPathSha256: createHash('sha256')
          .update(compound)
          .digest('hex'),
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('discovers a file-valued crontab environment setting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-crontab-env-file-'));
  const cron = join(directory, 'cron');
  const configuration = join(directory, 'application.conf');
  const worker = join(directory, 'worker');
  try {
    await Promise.all([
      writeFile(configuration, 'endpoint=http://127.0.0.1:11434\n'),
      writeFile(worker, '#!/bin/sh\nexit 0\n'),
      writeFile(cron, `CONFIG=${configuration}\n* * * * * ${worker}\n`),
    ]);
    await chmod(worker, 0o755);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); load_cron_inventory_helper; cron_inventory_anacrontab() { printf /etc/anacrontab; }; cron_inventory_system_file() { printf /etc/crontab; }; cron_inventory_system_dir() { printf /etc/cron.d; }; cron_inventory_hourly_dir() { printf /etc/cron.hourly; }; cron_inventory_daily_dir() { printf /etc/cron.daily; }; cron_inventory_weekly_dir() { printf /etc/cron.weekly; }; cron_inventory_monthly_dir() { printf /etc/cron.monthly; }; cron_inventory_command_targets user "$2" "$2"',
      'retire-ollama-crontab-env-file-test',
      script.pathname,
      cron,
    ]);
    assert.match(stdout, new RegExp(`^file\\t${configuration}$`, 'm'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
