import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rate: vi.fn(),
  connect: vi.fn(),
  read: vi.fn(),
  call: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/ai/provider', () => ({
  checkRateLimit: m.rate,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));
vi.mock('@/lib/payments/oxygen/runtime-service', () => ({
  readOxygenSnapshot: m.read,
}));

import { POST } from './route';

const id = '60000000-0000-4000-8000-000000000001';
const request = (body: unknown) =>
  new NextRequest('http://localhost/api/payments/oxygen/bank-details', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.csrf.mockResolvedValue({ valid: true });
  m.rate.mockReturnValue({ allowed: true });
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  m.connect.mockReturnValue({ provider: { call: m.call } });
  m.read.mockResolvedValue({
    stage: 'application_required',
    checkoutPhone: '08000000001',
  });
});
it('requires authentication before touching provider credentials', async () => {
  m.auth.mockResolvedValue({ error: 'unauthorized' });
  expect(
    (await POST(request({ workflowId: id, action: 'banks' }))).status
  ).toBe(401);
  expect(m.connect).not.toHaveBeenCalled();
});
it('rejects another customer workflow before calling the provider', async () => {
  m.read.mockRejectedValue(new Error('denied'));
  expect(
    (await POST(request({ workflowId: id, action: 'banks' }))).status
  ).toBe(404);
  expect(m.call).not.toHaveBeenCalled();
});
it('returns a bounded bank list', async () => {
  m.call.mockResolvedValue({
    Status: '00',
    Result: [{ Name: 'Test bank', SortCode: '001' }],
  });
  const r = await POST(request({ workflowId: id, action: 'banks' }));
  expect(await r.json()).toEqual({
    banks: [{ name: 'Test bank', code: '001' }],
  });
});
it('derives the phone from the owned checkout and returns only resolved account name', async () => {
  m.call.mockResolvedValue({
    success: true,
    errorCode: 0,
    accountName: ' TEST CUSTOMER ',
    privateData: 'hidden',
  });
  const r = await POST(
    request({
      workflowId: id,
      action: 'resolve',
      bank_code: '001',
      account_number: '0123456789',
    })
  );
  expect(await r.json()).toEqual({ accountName: 'TEST CUSTOMER' });
  expect(m.call).toHaveBeenCalledWith('name_enquiry', {
    bank_code: '001',
    account_number: '0123456789',
    phone_number: '2348000000001',
    type: 'EXTERNAL',
  });
});
it('rejects caller-selected phone and unsupported actions', async () => {
  expect(
    (
      await POST(
        request({
          workflowId: id,
          action: 'resolve',
          bank_code: '001',
          account_number: '0123456789',
          phone_number: '2348000000002',
        })
      )
    ).status
  ).toBe(400);
  expect(m.call).not.toHaveBeenCalled();
});
it('does not turn provider failure into a verified account', async () => {
  m.call.mockResolvedValue({
    success: false,
    errorCode: 1,
    accountName: 'test',
  });
  expect(
    (
      await POST(
        request({
          workflowId: id,
          action: 'resolve',
          bank_code: '001',
          account_number: '0123456789',
        })
      )
    ).status
  ).toBe(503);
});

it('uses the verified session for rate limiting and keeps CSRF and ownership guards', async () => {
  m.call.mockResolvedValue({ Status: '00', Result: [] });
  await POST(request({ workflowId: id, action: 'banks' }));
  expect(m.auth).toHaveBeenCalledOnce();
  expect(m.rate).toHaveBeenCalledWith('action:oxygen-bank-details:user', {
    requests: 10,
    windowMs: 60_000,
  });
  m.rate.mockReturnValue({ allowed: false });
  expect(
    (await POST(request({ workflowId: id, action: 'banks' }))).status
  ).toBe(429);
  m.rate.mockClear();
  m.csrf.mockResolvedValue({ valid: false });
  expect(
    (await POST(request({ workflowId: id, action: 'banks' }))).status
  ).toBe(403);
  expect(m.rate).not.toHaveBeenCalled();
});

it('exposes only phase durations for account lookup performance diagnosis', async () => {
  m.call.mockResolvedValue({
    success: true,
    errorCode: 0,
    accountName: 'TEST CUSTOMER',
  });
  const response = await POST(
    request({
      workflowId: id,
      action: 'resolve',
      bank_code: '001',
      account_number: '0123456789',
    })
  );
  const timing = response.headers.get('Server-Timing');
  expect(timing).toMatch(
    /^auth;dur=\d+(?:\.\d+)?, ownership;dur=\d+(?:\.\d+)?, oxygen;dur=\d+(?:\.\d+)?$/
  );
  expect(timing).not.toContain('0123456789');
  expect(timing).not.toContain(id);
  expect(timing).not.toContain('TEST CUSTOMER');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
