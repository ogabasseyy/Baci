import { expect, it, vi } from 'vitest';
import { startCustomerScheduleHttpFixture } from './customer-schedule-handler.http-support';

const fake = vi.hoisted(() => ({
  database: vi.fn(async () => ({ rows: [] })),
  server: vi.fn(async () => ({
    origin: 'http://127.0.0.1:3000',
    close: vi.fn(),
  })),
}));
vi.mock('./runtime-composition-server', () => ({
  startPiggyvestRuntimeCompositionServer: fake.server,
}));
vi.mock('./schedule-store.runtime-support', () => ({
  scheduleStoreRuntimeFixture: () => ({
    goalId: '30000000-0000-4000-8000-000000000402',
    database: fake.database,
    options: { configuration: {}, supabase: {} },
    getUser: vi.fn(),
  }),
}));
it('rejects external HTTP and requires a CSRF cookie before enabling fixture requests', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ csrfToken: 'synthetic' })
  );
  vi.stubGlobal('fetch', fetch);
  try {
    const fixture = await startCustomerScheduleHttpFixture();
    expect(() => fixture.localFetch('https://example.invalid')).toThrow(
      'External HTTP prohibited'
    );
    expect(fetch).not.toHaveBeenCalled();
    await expect(fixture.bootstrap()).rejects.toThrow('Missing CSRF cookie');
    expect(String(fetch.mock.calls[0][0])).toBe('http://127.0.0.1:3000/csrf');
    expect(fetch.mock.calls[0][1]?.redirect).toBe('error');
  } finally {
    vi.unstubAllGlobals();
  }
});
