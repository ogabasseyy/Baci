import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));

import { GET } from './route';

const id = '60000000-0000-4000-8000-000000000001';
const request = (value = id) =>
  new NextRequest(
    `http://localhost/api/payments/oxygen/approval-code?workflowId=${value}`
  );
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id }, supabase: { rpc: m.rpc } });
  m.rpc.mockResolvedValue({
    data: {
      bookingReference: id,
      sentAt: '2026-10-24T11:00:00+00:00',
      expiresAt: '2026-10-24T11:05:00+00:00',
    },
    error: null,
  });
});
it('reads only timing metadata through the customer RPC with no caching', async () => {
  const result = await GET(request());
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('oxygen_approval_code_window', {
    p_workflow_id: id,
  });
});
it('requires auth and a valid workflow id', async () => {
  expect((await GET(request('invalid'))).status).toBe(400);
  m.auth.mockResolvedValue({ error: 'Unauthorized' });
  expect((await GET(request())).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('handles missing timing and redacts failed or malformed responses', async () => {
  m.rpc.mockResolvedValue({ data: null, error: null });
  expect(await (await GET(request())).json()).toEqual({ window: null });
  m.rpc.mockResolvedValue({ data: { activityToken: 'private' }, error: null });
  expect((await GET(request())).status).toBe(503);
  m.rpc.mockResolvedValue({ error: { code: '42501', message: 'private' } });
  const denied = await GET(request());
  expect(denied.status).toBe(404);
  expect(await denied.text()).not.toContain('private');
});
