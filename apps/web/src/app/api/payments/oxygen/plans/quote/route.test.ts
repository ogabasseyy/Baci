import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  connect: vi.fn(),
  quote: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: m.limit,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));
vi.mock('@/lib/payments/oxygen/quote-plan', () => ({
  quoteOxygenPlan: m.quote,
}));

import { POST } from './route';

const id = '60000000-0000-4000-8000-000000000001';
const input = {
  workflowId: id,
  idempotencyKey: id,
  equityPercentage: 37.25,
  tenure: 6,
};
const request = (body: unknown = input) =>
  new NextRequest('http://localhost/api/payments/oxygen/plans/quote', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    user: { id: 'customer' },
    supabase: { rpc: vi.fn() },
  });
  m.csrf.mockResolvedValue({ valid: true });
  m.limit.mockResolvedValue(true);
  m.connect.mockReturnValue({ provider: {} });
  m.quote.mockResolvedValue({ plans: [], selectedReference: null });
});
it('authenticates, validates, and returns a private uncached response', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(m.quote.mock.calls[0][2]).toEqual(input);
});
it('requires auth and CSRF before quoting', async () => {
  m.auth.mockResolvedValue({ error: 'Unauthorized' });
  expect((await POST(request())).status).toBe(401);
  m.auth.mockResolvedValue({ user: { id: 'customer' }, supabase: {} });
  m.csrf.mockResolvedValue({ valid: false });
  expect((await POST(request())).status).toBe(403);
  expect(m.quote).not.toHaveBeenCalled();
});
it.each([
  { ...input, tenure: 13 },
  { ...input, equityPercentage: 35.250049 },
  { ...input, approve: true },
])('rejects invalid or client-authored fields', async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(m.quote).not.toHaveBeenCalled();
});
it('bounds input, rate-limits quotes and hides provider details', async () => {
  expect((await POST(request({ padding: 'a'.repeat(2100) }))).status).toBe(400);
  m.limit.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(429);
  m.limit.mockResolvedValue(true);
  m.quote.mockRejectedValue(new Error('private'));
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('private');
});
