import { describe, expect, it, vi } from 'vitest';
import { runSupabaseHistoryReplay } from './run-supabase-history-replay';
import { createSupabaseReplayRuntimeFixture } from './run-supabase-history-replay-test-runtime';

// Split from run-supabase-history-replay.test.ts per the 300-line
// module boundary: keep-mode teardown behavior lives here.
describe('runSupabaseHistoryReplay keep mode', () => {
  it('removes the workdir on pre-ownership failure without keep mode', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    fixture.deps.writeOwnership = vi.fn(async () => {
      throw new Error('ownership write failed');
    });
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await expect(
      runSupabaseHistoryReplay(fixture.replayOptions(), fixture.deps)
    ).rejects.toThrow(/^ownership write failed$/);
    expect(fixture.removed).toEqual([fixture.workdir]);
    expect(stderrWrite).not.toHaveBeenCalled();
    stderrWrite.mockRestore();
  });

  it('retains the workdir and prints its path on pre-ownership failure with keep mode', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    fixture.deps.writeOwnership = vi.fn(async () => {
      throw new Error('ownership write failed');
    });
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    vi.stubEnv('BACI_REPLAY_KEEP', '1');
    try {
      await expect(
        runSupabaseHistoryReplay(fixture.replayOptions(), fixture.deps)
      ).rejects.toThrow(/^ownership write failed$/);
      expect(fixture.removed).toEqual([]);
      expect(stderrWrite).toHaveBeenCalledWith(`kept:${fixture.workdir}\n`);
    } finally {
      vi.unstubAllEnvs();
      stderrWrite.mockRestore();
    }
  });
});
