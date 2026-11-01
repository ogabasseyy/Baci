import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));

import { POST } from './route';

const id = '60000000-0000-4000-8000-000000000001';
const request = (
  body: unknown = { workflowId: id, bookingReference: id, version: 4 }
) =>
  new NextRequest('http://localhost/api/payments/oxygen/plans/accept', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id }, supabase: { rpc: m.rpc } });
  m.csrf.mockResolvedValue({ valid: true });
  m.rpc.mockResolvedValue({
    error: null,
    data: { bookingReference: id, version: 5 },
  });
});
it('accepts a specific cached plan through the customer-scoped RPC', async () => {
  expect((await POST(request())).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('oxygen_accept_saved_plan', {
    p_workflow_id: id,
    p_booking_reference: id,
    p_version: 4,
  });
});
it('requires authentication, CSRF, and strict validated input before database work', async () => {
  m.auth.mockResolvedValueOnce({ error: 'unauthorized' });
  expect((await POST(request())).status).toBe(401);
  m.csrf.mockResolvedValueOnce({ valid: false });
  expect((await POST(request())).status).toBe(403);
  expect(
    (
      await POST(
        request({ workflowId: id, bookingReference: id, version: 4, state: {} })
      )
    ).status
  ).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('fails closed on stale version, ownership denial and bad RPC result', async () => {
  m.rpc.mockResolvedValueOnce({ error: { code: '40001' } });
  expect((await POST(request())).status).toBe(409);
  m.rpc.mockResolvedValueOnce({ error: { code: '42501' } });
  expect((await POST(request())).status).toBe(404);
  m.rpc.mockResolvedValueOnce({
    data: {
      bookingReference: '70000000-0000-4000-8000-000000000001',
      version: 5,
    },
    error: null,
  });
  expect((await POST(request())).status).toBe(503);
});
