import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  rate: vi.fn(),
  connect: vi.fn(),
  snapshot: vi.fn(),
  status: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/rate-limit', () => ({
  checkOxygenProviderRateLimit: m.rate,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));
vi.mock('@/lib/payments/oxygen/runtime-service', () => ({
  readOxygenSnapshot: m.snapshot,
}));
vi.mock('@/lib/payments/oxygen/selfie-status', () => ({
  readOxygenSelfieStatus: m.status,
}));

import { GET } from './route';

const id = '60000000-0000-4000-8000-000000000001';
const request = () =>
  new NextRequest(
    `http://localhost:3000/api/payments/oxygen/workflows/selfie-status?workflowId=${id}`
  );
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  m.rate.mockResolvedValue({ allowed: true });
  m.snapshot.mockResolvedValue({});
  m.connect.mockReturnValue({
    worker: vi.fn(),
    provider: {},
    partnerReference: 'partner',
  });
});
it('requires authentication before accessing provider credentials', async () => {
  m.auth.mockResolvedValue({ error: 'Unauthorized' });
  expect((await GET(request())).status).toBe(401);
  expect(m.connect).not.toHaveBeenCalled();
});
it('checks ownership before connecting to Oxygen', async () => {
  m.snapshot.mockRejectedValue(new Error('not owned'));
  expect((await GET(request())).status).toBe(404);
  expect(m.connect).not.toHaveBeenCalled();
});
it('rate limits status reads without connecting to Oxygen', async () => {
  m.rate.mockResolvedValue({ allowed: false });
  expect((await GET(request())).status).toBe(429);
  expect(m.connect).not.toHaveBeenCalled();
  expect(m.snapshot).not.toHaveBeenCalled();
});
it('limits authenticated users before invalid or foreign workflow lookups', async () => {
  m.rate.mockResolvedValueOnce({ allowed: false });
  const response = await GET(
    new NextRequest(
      'http://localhost:3000/api/payments/oxygen/workflows/selfie-status?workflowId=invalid'
    )
  );
  expect(response.status).toBe(429);
  expect(m.rate).toHaveBeenCalledWith('user', 'selfie-status-user', 12);
  expect(m.snapshot).not.toHaveBeenCalled();
});
it('does not consume another workflow budget until ownership is verified', async () => {
  m.snapshot.mockRejectedValueOnce(new Error('foreign'));
  expect((await GET(request())).status).toBe(404);
  expect(m.rate).toHaveBeenCalledTimes(1);
  expect(m.rate).toHaveBeenCalledWith('user', 'selfie-status-user', 12);
});
it('uses the shared six-per-minute user and owned-workflow budget', async () => {
  m.status.mockResolvedValue({ confirmed: false });
  expect((await GET(request())).status).toBe(200);
  expect(m.rate).toHaveBeenCalledWith(`user:${id}`, 'selfie-status', 6);
  expect(m.rate).toHaveBeenCalledWith('user', 'selfie-status-user', 12);
  expect(m.rate.mock.invocationCallOrder[0]).toBeLessThan(
    m.snapshot.mock.invocationCallOrder[0]
  );
  expect(m.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
    m.rate.mock.invocationCallOrder[1]
  );
});
it('denies provider access when the user-wide budget is exhausted', async () => {
  m.rate.mockResolvedValueOnce({ allowed: false });
  expect((await GET(request())).status).toBe(429);
  expect(m.connect).not.toHaveBeenCalled();
});
it('denies provider access when only the workflow budget is exhausted', async () => {
  m.rate
    .mockResolvedValueOnce({ allowed: true })
    .mockResolvedValueOnce({ allowed: false });
  expect((await GET(request())).status).toBe(429);
  expect(m.rate).toHaveBeenNthCalledWith(1, 'user', 'selfie-status-user', 12);
  expect(m.rate).toHaveBeenNthCalledWith(2, `user:${id}`, 'selfie-status', 6);
  expect(m.connect).not.toHaveBeenCalled();
  expect(m.status).not.toHaveBeenCalled();
});
it('fails closed if the shared limiter throws', async () => {
  m.rate.mockRejectedValue(new Error('private redis failure'));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private redis failure');
  expect(m.connect).not.toHaveBeenCalled();
});
it('returns only confirmed selfie status and prevents caching', async () => {
  const value = { confirmed: true, checkedAt: '2026-10-25T21:00:00Z' };
  m.status.mockResolvedValue(value);
  const response = await GET(request());
  expect(await response.json()).toEqual(value);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
it('does not expose upstream failures', async () => {
  m.status.mockRejectedValue(new Error('private diagnostic'));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    'private diagnostic'
  );
});
