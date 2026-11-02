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
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: m.rate,
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
  m.rate.mockResolvedValue(true);
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
  m.rate.mockResolvedValue(false);
  expect((await GET(request())).status).toBe(429);
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
