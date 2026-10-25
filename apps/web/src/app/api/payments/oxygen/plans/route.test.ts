import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));

import { GET, POST } from './route';

const id = '60000000-0000-4000-8000-000000000001';
const get = () =>
  new NextRequest(
    `http://localhost/api/payments/oxygen/plans?workflowId=${id}`
  );
const post = (
  body: string = JSON.stringify({ workflowId: id, bookingReference: id })
) =>
  new NextRequest('http://localhost/api/payments/oxygen/plans', {
    method: 'POST',
    body,
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    user: { id: 'customer' },
    supabase: { rpc: m.rpc },
  });
  m.csrf.mockResolvedValue({ valid: true });
  m.rpc.mockResolvedValue({
    data: { plans: [], selectedReference: null },
    error: null,
  });
});
it('reads only through the authenticated customer RPC and prevents HTTP caching', async () => {
  const res = await GET(get());
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(m.rpc).toHaveBeenCalledWith('oxygen_saved_plans', {
    p_workflow_id: id,
    p_booking_reference: null,
  });
});
it('saves only a reference preference, with no loan or provider mutation', async () => {
  expect((await POST(post())).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith('oxygen_saved_plans', {
    p_workflow_id: id,
    p_booking_reference: id,
  });
  expect(m.rpc).toHaveBeenCalledTimes(1);
});
it('requires authentication and CSRF for selection', async () => {
  m.auth.mockResolvedValue({ error: 'Unauthorized' });
  expect((await GET(get())).status).toBe(401);
  expect((await POST(post())).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
  m.auth.mockResolvedValue({
    user: { id: 'customer' },
    supabase: { rpc: m.rpc },
  });
  m.csrf.mockResolvedValue({ valid: false });
  expect((await POST(post())).status).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('rejects malformed JSON and client-authored plan data', async () => {
  expect((await POST(post('{'))).status).toBe(400);
  expect(
    (
      await POST(
        post(
          JSON.stringify({ workflowId: id, bookingReference: id, state: {} })
        )
      )
    ).status
  ).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('redacts database errors, invalid cached payloads and rejected reads', async () => {
  m.rpc.mockResolvedValue({
    error: { code: '42501', message: 'private error' },
  });
  let res = await GET(get());
  expect(res.status).toBe(404);
  expect(await res.text()).not.toContain('private');
  m.rpc.mockResolvedValue({
    data: { plans: [{ secret: 'private' }] },
    error: null,
  });
  expect((await GET(get())).status).toBe(503);
  m.rpc.mockRejectedValue(new Error('private'));
  res = await GET(get());
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain('private');
});
it('distinguishes transient RPC failures from ownership denials', async () => {
  m.rpc.mockResolvedValue({ error: { code: '08006', message: 'private' } });
  expect((await GET(get())).status).toBe(503);
});
it('bounds selection JSON even without a content-length header', async () => {
  const body = JSON.stringify({
    workflowId: id,
    bookingReference: id,
    padding: 'x'.repeat(4096),
  });
  const response = await POST(post(body));
  expect(response.status).toBe(413);
  expect(m.rpc).not.toHaveBeenCalled();
});
