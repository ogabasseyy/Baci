import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  connect: vi.fn(),
  read: vi.fn(),
  perform: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: m.limit,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));
vi.mock('@/lib/payments/oxygen/payment-recovery', () => ({
  performOxygenPaymentRecovery: m.perform,
  readOxygenPaymentRecovery: m.read,
}));
vi.mock('@/lib/payments/oxygen/payment-recovery-evidence', () => ({
  createOxygenPaymentRecoveryRecorder: vi.fn(),
}));

import { GET, POST } from './route';

const id = '60000000-0000-4000-8000-000000000001';
const input = {
  workflowId: id,
  reference: id,
  version: 3,
  idempotencyKey: id,
  action: 'check_status',
};
const request = (body: unknown = input) =>
  new NextRequest('http://localhost/api/payments/oxygen/recovery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id }, supabase: { rpc: vi.fn() } });
  m.csrf.mockResolvedValue({ valid: true });
  m.limit.mockResolvedValue(true);
  m.connect.mockReturnValue({
    worker: vi.fn(),
    recoveryProvider: vi.fn(),
    hosts: new Set(['payment.hydrogenpay.com']),
  });
  m.read.mockResolvedValue({ reference: id });
  m.perform.mockResolvedValue({ reference: id });
});
it('authenticates before any saved recovery read', async () => {
  m.auth.mockResolvedValue({ error: 'Unauthorized' });
  expect(
    (
      await GET(
        new NextRequest(
          `http://localhost/api/payments/oxygen/recovery?workflowId=${id}`
        )
      )
    ).status
  ).toBe(401);
  expect(m.read).not.toHaveBeenCalled();
});
it('requires CSRF and customer auth for every mutation', async () => {
  m.csrf.mockResolvedValue({ valid: false });
  expect((await POST(request())).status).toBe(403);
  expect(m.perform).not.toHaveBeenCalled();
  m.csrf.mockResolvedValue({ valid: true });
  m.auth.mockResolvedValue({ error: 'Unauthorized' });
  expect((await POST(request())).status).toBe(401);
  expect(m.perform).not.toHaveBeenCalled();
});
it('rejects malformed JSON, unknown operations and approval attempts', async () => {
  const malformed = new NextRequest(
    'http://localhost/api/payments/oxygen/recovery',
    { method: 'POST', body: '{' }
  );
  expect((await POST(malformed)).status).toBe(400);
  expect(
    (
      await POST(
        request({ ...input, action: 'approve_booking', otp: '123456' })
      )
    ).status
  ).toBe(400);
  expect(m.perform).not.toHaveBeenCalled();
});
it('limits explicit recovery requests and never exposes internal error details', async () => {
  m.limit.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(429);
  expect(m.perform).not.toHaveBeenCalled();
  m.limit.mockResolvedValue(true);
  m.perform.mockRejectedValue(new Error('secret-link-token'));
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('secret-link-token');
});
it('returns successful recovery with no browser caching and exact input binding', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(m.perform.mock.calls[0][4]).toEqual(input);
});
it('uses the normal scoped RPC for cached links', async () => {
  const response = await GET(
    new NextRequest(
      `http://localhost/api/payments/oxygen/recovery?workflowId=${id}`
    )
  );
  expect(response.status).toBe(200);
  expect(m.read.mock.calls[0][1]).toBe(id);
  expect(m.perform).not.toHaveBeenCalled();
});
