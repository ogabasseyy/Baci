import { expect, it, vi } from 'vitest';
import { startScheduleJourneyFixture } from './schedule-journey.http-support';

const fixture = vi.hoisted(() => ({ close: vi.fn(async () => undefined) }));
vi.mock('./runtime-composition-server', () => ({
  startPiggyvestRuntimeCompositionServer: async () => ({
    origin: 'http://127.0.0.1:3000',
    close: fixture.close,
  }),
}));
vi.mock('./schedule-store.runtime-support', () => ({
  scheduleStoreRuntimeFixture: () => ({
    goalId: '30000000-0000-4000-8000-000000000403',
    database: vi.fn(),
    options: { configuration: {} },
  }),
}));
it('closes the isolated listener on failed CSRF bootstrap without issuing schedule writes', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 })
  );
  vi.stubGlobal('fetch', fetch);
  try {
    await expect(startScheduleJourneyFixture('c')).rejects.toThrow(
      'CSRF bootstrap unavailable'
    );
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe('http://127.0.0.1:3000/csrf');
  } finally {
    vi.unstubAllGlobals();
  }
});
