import { describe, expect, it, vi } from 'vitest';
import { diagnoseReplayDatabaseExit } from './diagnose-replay-database-exit';

describe('diagnoseReplayDatabaseExit', () => {
  it('reports a bounded backend crash class without exposing logs', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: '',
      stderr:
        'secret token\n2026-11-01 21:13:00 UTC [12] LOG: server process (PID 42) was terminated by signal 11: Segmentation fault\nstatement contains private data',
    });
    expect(
      await diagnoseReplayDatabaseExit('supabase_db_baci-replay-123', run)
    ).toBe('database-backend-signal-11');
  });

  it('returns no raw database output or unrecognized signal', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ stdout: 'secret', stderr: 'password: example' });
    expect(
      await diagnoseReplayDatabaseExit('supabase_db_baci-replay-123', run)
    ).toBeNull();
    expect(
      await diagnoseReplayDatabaseExit('untrusted;command', run)
    ).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not mask the original failure if diagnostic retrieval fails', async () => {
    const run = vi.fn().mockRejectedValue(new Error('sensitive error'));
    expect(
      await diagnoseReplayDatabaseExit('supabase_db_baci-replay-123', run)
    ).toBeNull();
  });
});

it('only inspects the owned database for connection-loss failures', async () => {
  const { withDatabaseExitDiagnostic } = await import(
    './replay-failure-diagnostics'
  );
  const run = vi.fn().mockResolvedValue({
    stdout: '',
    stderr: 'LOG: server process (PID 42) was terminated by signal 11',
  });
  const resources = {
    containers: [{ name: 'supabase_db_baci-replay-123' }],
    networks: [],
    volumes: [],
  };
  const ordinary = new Error('other failure');
  expect(await withDatabaseExitDiagnostic(ordinary, resources, run)).toBe(
    ordinary
  );
  expect(run).not.toHaveBeenCalled();
  const lost = new Error('Replay SQL check failed (reason=connection-lost)');
  const diagnosed = await withDatabaseExitDiagnostic(lost, resources, run);
  expect(diagnosed).toBeInstanceOf(Error);
  expect((diagnosed as Error).message).toContain(
    'diagnostic=database-backend-signal-11'
  );
});
