import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  csrf: vi.fn(),
  limit: vi.fn(),
  connect: vi.fn(),
  redeem: vi.fn(),
  worker: vi.fn(),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: m.limit,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));
vi.mock('@/lib/payments/oxygen/durable-phone-handoff', () => ({
  redeemDurableOxygenHandoff: m.redeem,
}));

import { POST } from './route';

const request = (
  token = 't'.repeat(43),
  origin = 'https://handoff.example.test'
) =>
  new NextRequest(
    'https://handoff.example.test/api/payments/oxygen/phone-handoff/redeem',
    {
      method: 'POST',
      headers: { Origin: origin },
      body: JSON.stringify({ token }),
    }
  );
beforeEach(() => {
  vi.resetAllMocks();
  m.csrf.mockResolvedValue({ valid: true });
  m.limit.mockResolvedValue(true);
  m.connect.mockReturnValue({
    worker: m.worker,
    phoneConfiguration: { origin: 'https://handoff.example.test' },
  });
  m.redeem.mockResolvedValue({
    url: 'https://selfie.example.test/?token=private',
  });
});
it('requires CSRF, rate limit, origin and valid capability before worker login', async () => {
  m.csrf.mockResolvedValueOnce({ valid: false });
  expect((await POST(request())).status).toBe(403);
  m.limit.mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(429);
  expect((await POST(request(undefined, 'https://evil.test'))).status).toBe(
    403
  );
  expect((await POST(request('bad'))).status).toBe(400);
  expect(m.worker).not.toHaveBeenCalled();
});
it('returns the exact exchanged target without caching it', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(await response.json()).toEqual({
    url: 'https://selfie.example.test/?token=private',
  });
  expect(m.redeem).toHaveBeenCalledTimes(1);
});
it('fails closed on disabled configuration and consumed/expired capability', async () => {
  m.connect.mockReturnValueOnce(null);
  expect((await POST(request())).status).toBe(503);
  m.redeem.mockRejectedValueOnce(new Error('private provider data'));
  const response = await POST(request());
  expect(response.status).toBe(410);
  expect(JSON.stringify(await response.json())).not.toContain(
    'private provider data'
  );
});
