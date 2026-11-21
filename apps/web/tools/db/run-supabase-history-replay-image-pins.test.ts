import { describe, expect, it, vi } from 'vitest';
import { runSupabaseHistoryReplay } from './run-supabase-history-replay';
import { createSupabaseReplayRuntimeFixture } from './run-supabase-history-replay-test-runtime';

describe('runSupabaseHistoryReplay image pins', () => {
  it('pins the service images once, after init and before the database starts', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();

    await runSupabaseHistoryReplay(fixture.replayOptions(), fixture.deps);

    expect(fixture.deps.writeImagePins).toHaveBeenCalledTimes(1);
    expect(fixture.deps.writeImagePins).toHaveBeenCalledWith(fixture.workdir);
    const pin = fixture.commands.indexOf(`pin images ${fixture.workdir}`);
    expect(pin).toBeGreaterThan(
      fixture.commands.indexOf(`supabase init --workdir ${fixture.workdir}`)
    );
    expect(pin).toBeLessThan(
      fixture.commands.indexOf(`supabase db start --workdir ${fixture.workdir}`)
    );
  });

  it('cleans up without starting the database when the image pins cannot be written', async () => {
    const fixture = createSupabaseReplayRuntimeFixture();
    fixture.deps.writeImagePins = vi.fn(() =>
      Promise.reject(new Error('EACCES: /secret/location'))
    );

    const failure = await runSupabaseHistoryReplay(
      fixture.replayOptions(),
      fixture.deps
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: 'Supabase replay stage pin images failed',
    });
    expect((failure as Error).message).not.toContain('/secret/location');
    expect(fixture.commands).not.toContain(
      `supabase db start --workdir ${fixture.workdir}`
    );
    expect(fixture.commands).toContain(
      `supabase stop --no-backup --workdir ${fixture.workdir}`
    );
    expect(fixture.removed).toEqual([fixture.workdir]);
  });
});
