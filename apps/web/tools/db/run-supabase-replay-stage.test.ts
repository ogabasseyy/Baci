import { describe, expect, it } from 'vitest';
import { runSupabaseReplayStage } from './run-supabase-replay-stage';

describe('runSupabaseReplayStage', () => {
  it.each([
    'init',
    'db start',
    'migration up',
    'status',
    'gen types',
  ] as const)('adds the %s stage and keeps only allowlisted diagnostics', async (stage) => {
    await expect(
      runSupabaseReplayStage(stage, async () => {
        throw new Error(
          'supabase failed: non-zero-exit secret https://user:password@db.example'
        );
      })
    ).rejects.toThrow(`Supabase replay stage ${stage} failed`);
  });

  it('retains an allowlisted failure class and SQLSTATE without private output', async () => {
    const failure = await runSupabaseReplayStage('migration up', async () => {
      throw new Error(
        'supabase failed: non-zero-exit (line=42,sqlstate=42501)'
      );
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message:
        'Supabase replay stage migration up failed (supabase failed: non-zero-exit (line=42,sqlstate=42501))',
    });
  });

  it('does not expose unrecognized subprocess errors', async () => {
    const secret = 'token=private-value';

    const failure = await runSupabaseReplayStage('status', async () => {
      throw new Error(`internal failure ${secret}`);
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: 'Supabase replay stage status failed',
    });
    expect((failure as Error).message).not.toContain(secret);
  });
});
