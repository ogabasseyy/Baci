import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseReplaySqlApplier } from './create-supabase-replay-sql-applier';
import type { ReplayCommand } from './supabase-history-replay-types';

const url = 'postgresql://postgres:test-only@127.0.0.1:41001/postgres';
const source = '20261004071812_connector_retention_one_year.sql';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function retentionFile(bytes?: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'connector-cron-replay-'));
  directories.push(dir);
  const file = path.join(dir, `1383-${source}`);
  await writeFile(
    file,
    bytes ??
      (await readFile(
        path.resolve('../../supabase/migrations', source),
        'utf8'
      ))
  );
  return file;
}

describe('createSupabaseReplaySqlApplier', () => {
  it('provides the real cron schema before unchanged retention SQL with jobs disabled', async () => {
    const run = vi
      .fn<ReplayCommand>()
      .mockResolvedValue({ stdout: '', stderr: '' });
    const file = await retentionFile();
    await createSupabaseReplaySqlApplier(run, 'psql', url)(file);
    const calls = run.mock.calls.map(([, args]) => args.join(' '));
    expect(calls).toHaveLength(4);
    expect(calls[0]).toContain(
      "ALTER SYSTEM SET cron.launch_active_jobs = 'off'"
    );
    expect(calls[1]).toContain('pg_reload_conf()');
    expect(calls[2]).toContain(
      "current_setting('cron.launch_active_jobs') <> 'off'"
    );
    expect(calls[2]).toContain('CREATE EXTENSION IF NOT EXISTS pg_cron');
    expect(calls[3]).toContain(`-f ${file}`);
    for (const [, args, options] of run.mock.calls) {
      expect(args.join(' ')).not.toContain('test-only');
      expect(options?.env?.PGHOST).toBe('127.0.0.1');
    }
  });

  it('leaves unrelated migrations unchanged and does not provision cron', async () => {
    const run = vi
      .fn<ReplayCommand>()
      .mockResolvedValue({ stdout: '', stderr: '' });
    await createSupabaseReplaySqlApplier(
      run,
      'psql',
      url
    )('/tmp/126-other.sql');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toContain('/tmp/126-other.sql');
  });

  it('rejects changed retention bytes before any database command', async () => {
    const run = vi.fn<ReplayCommand>();
    await expect(
      createSupabaseReplaySqlApplier(
        run,
        'psql',
        url
      )(await retentionFile('SELECT 1;'))
    ).rejects.toThrow('source hash mismatch');
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed if cron isolation fails', async () => {
    const run = vi
      .fn<ReplayCommand>()
      .mockRejectedValue(new Error('isolation failed'));
    await expect(
      createSupabaseReplaySqlApplier(run, 'psql', url)(await retentionFile())
    ).rejects.toThrow('isolation failed');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses a remote database before provisioning', () => {
    const run = vi.fn<ReplayCommand>();
    expect(() =>
      createSupabaseReplaySqlApplier(
        run,
        'psql',
        url.replace('127.0.0.1', 'production.example.com')
      )
    ).toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
