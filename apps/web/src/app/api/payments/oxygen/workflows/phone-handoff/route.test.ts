import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  connect: vi.fn(),
  issue: vi.fn(),
  local: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: m.limit,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));
vi.mock('@/lib/payments/oxygen/durable-phone-handoff', () => ({
  issueDurableOxygenHandoff: m.issue,
}));
vi.mock('@/lib/payments/oxygen/phone-handoff', () => ({
  issueOxygenPhoneHandoff: m.local,
}));

import { POST } from './route';

const id = '60000000-0000-4000-8000-000000000001';
const request = (workflowId = id) =>
  new NextRequest(
    'https://shop.test/api/payments/oxygen/workflows/phone-handoff',
    { method: 'POST', body: JSON.stringify({ workflowId }) }
  );
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id: 'owner' }, supabase: {} });
  m.csrf.mockResolvedValue({ valid: true });
  m.limit.mockResolvedValue(true);
  m.connect.mockReturnValue({
    phoneConfiguration: {},
    worker: vi.fn(),
    provider: {},
    partnerReference: 'partner',
  });
  m.issue.mockResolvedValue({
    qr: 'data:image/png;base64,test',
    expiresAt: Date.now() + 10000,
  });
});
it('checks auth before all validation and storage work', async () => {
  m.auth.mockResolvedValueOnce({ user: null });
  expect((await POST(request())).status).toBe(401);
  expect(m.csrf).not.toHaveBeenCalled();
  expect(m.issue).not.toHaveBeenCalled();
});
it('requires valid input, CSRF and rate admission before issuing a handoff', async () => {
  m.csrf.mockResolvedValueOnce({ valid: false });
  expect((await POST(request())).status).toBe(403);
  expect((await POST(request('bad'))).status).toBe(400);
  m.limit.mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(429);
  expect(m.issue).not.toHaveBeenCalled();
});
it('uses the durable issuer when configured and never touches the loopback bridge', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(m.issue).toHaveBeenCalledOnce();
  expect(m.local).not.toHaveBeenCalled();
});
