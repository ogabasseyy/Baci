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
vi.mock('@/lib/rate-limit', () => ({
  checkOxygenPhoneRedemptionRateLimit: m.limit,
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
      body: JSON.stringify({
        token,
        selfieOrigins: ['https://selfie.example.test'],
      }),
    }
  );
beforeEach(() => {
  vi.resetAllMocks();
  m.csrf.mockResolvedValue({ valid: true });
  m.limit.mockResolvedValue({ allowed: true });
  m.worker.mockResolvedValue({ rpc: vi.fn() });
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
  m.limit.mockResolvedValueOnce({ allowed: false });
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
it('passes the page allowlist to redemption before the token can be consumed', async () => {
  const response = await POST(
    new NextRequest(
      'https://handoff.example.test/api/payments/oxygen/phone-handoff/redeem',
      {
        method: 'POST',
        headers: { Origin: 'https://handoff.example.test' },
        body: JSON.stringify({
          token: 't'.repeat(43),
          selfieOrigins: ['https://selfie.example.test'],
        }),
      }
    )
  );
  expect(response.status).toBe(200);
  expect(m.redeem).toHaveBeenCalledWith(
    expect.anything(),
    't'.repeat(43),
    expect.anything(),
    ['https://selfie.example.test']
  );
});
it('rejects a request with no browser allowlist before worker access', async () => {
  const response = await POST(
    new NextRequest(
      'https://handoff.example.test/api/payments/oxygen/phone-handoff/redeem',
      {
        method: 'POST',
        headers: { Origin: 'https://handoff.example.test' },
        body: JSON.stringify({ token: 't'.repeat(43) }),
      }
    )
  );
  expect(response.status).toBe(400);
  expect(m.worker).not.toHaveBeenCalled();
  expect(m.redeem).not.toHaveBeenCalled();
});
it('reports an uncertain redemption without claiming the link expired', async () => {
  m.connect.mockReturnValueOnce(null);
  expect((await POST(request())).status).toBe(503);
  m.redeem.mockRejectedValueOnce(new Error('private provider data'));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.clone().json()).toEqual({
    error:
      'We couldn’t open this link. Return to your other device and generate a new QR code.',
  });
  expect(JSON.stringify(await response.json())).not.toContain(
    'private provider data'
  );
});

it('rejects unavailable handoff configuration before consuming a capability', async () => {
  m.connect.mockReturnValue({ worker: m.worker, phoneConfiguration: null });
  expect((await POST(request())).status).toBe(503);
  expect(m.worker).not.toHaveBeenCalled();
  expect(m.redeem).not.toHaveBeenCalled();
});
