import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rate: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/lib/rate-limit', () => ({ checkOxygenProviderRateLimit: m.rate }));

import { POST } from './route';

const workflowId = '60000000-0000-4000-8000-000000000001';
const idempotencyKey = '70000000-0000-4000-8000-000000000001';
const request = (body: unknown = { workflowId, version: 2, idempotencyKey }) =>
  new NextRequest(
    'http://localhost/api/payments/oxygen/workflows/phone-recovery',
    { method: 'POST', body: JSON.stringify(body) }
  );
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    user: { id: workflowId },
    supabase: { rpc: m.rpc },
  });
  m.csrf.mockResolvedValue({ valid: true });
  m.rate.mockResolvedValue({ allowed: true });
  m.rpc.mockResolvedValue({ data: true, error: null });
});
it('requires auth, CSRF, valid input, and rate limit before retiring', async () => {
  m.auth.mockResolvedValueOnce({ error: 'Unauthorized' });
  expect((await POST(request())).status).toBe(401);
  m.csrf.mockResolvedValueOnce({ valid: false });
  expect((await POST(request())).status).toBe(403);
  expect(
    (await POST(request({ workflowId, version: -1, idempotencyKey }))).status
  ).toBe(400);
  m.rate.mockResolvedValueOnce({ allowed: false });
  expect((await POST(request())).status).toBe(429);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('calls only the scoped retirement RPC and fails closed on a lost claim', async () => {
  expect((await POST(request())).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith(
    'oxygen_abandon_queued_phone_verification',
    { p_workflow_id: workflowId, p_version: 2, p_key: idempotencyKey }
  );
  m.rpc.mockResolvedValueOnce({ data: false, error: null });
  expect((await POST(request())).status).toBe(409);
  m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'private' } });
  const result = await POST(request());
  expect(result.status).toBe(409);
  expect(JSON.stringify(await result.json())).not.toContain('private');
});
