import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rate: vi.fn(),
  connect: vi.fn(),
  perform: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: m.rate,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));

vi.mock('@/lib/payments/oxygen/runtime-service', () => ({
  performOxygenAction: m.perform,
  readOxygenSnapshot: vi.fn(),
}));

import { OxygenProviderFailure } from '@/lib/payments/oxygen/provider';
import { POST } from './route';

beforeEach(() => {
  vi.resetAllMocks();
  m.rate.mockResolvedValue(true);
  m.csrf.mockResolvedValue({ valid: true });
  m.auth.mockResolvedValue({ error: 'Unauthorized' });
});
it('does not touch runtime credentials for unauthenticated callers', async () => {
  const result = await POST(
    new NextRequest('http://localhost/api/payments/oxygen/workflows/actions', {
      method: 'POST',
      body: '{}',
    })
  );
  expect(result.status).toBe(401);
  expect(m.connect).not.toHaveBeenCalled();
});
it('rejects activation as unsupported input', async () => {
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  const result = await POST(
    new NextRequest('http://localhost/api/payments/oxygen/workflows/actions', {
      method: 'POST',
      body: JSON.stringify({
        workflowId: '60000000-0000-4000-8000-000000000001',
        idempotencyKey: '60000000-0000-4000-8000-000000000002',
        version: 0,
        command: { action: 'activate' },
      }),
      headers: { 'content-type': 'application/json' },
    })
  );
  expect(result.status).toBe(400);
  expect(m.connect).not.toHaveBeenCalled();
});

it('allows a multi-step checkout budget while keeping each operation limited', async () => {
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  m.rate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const result = await POST(
    new NextRequest('http://localhost/api/payments/oxygen/workflows/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: '60000000-0000-4000-8000-000000000001',
        idempotencyKey: '60000000-0000-4000-8000-000000000002',
        version: 1,
        command: { action: 'refresh_kyc' },
      }),
    })
  );
  expect(result.status).toBe(429);
  expect(m.rate).toHaveBeenNthCalledWith(1, 'oxygen-provider-request', {
    requests: 30,
    windowMs: 60_000,
  });
  expect(m.rate).toHaveBeenNthCalledWith(
    2,
    'oxygen-provider-action:refresh_kyc',
    { requests: 6, windowMs: 60_000 }
  );
  expect(m.connect).not.toHaveBeenCalled();
});

it('keeps OTP resends at six attempts per minute', async () => {
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  m.rate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const result = await POST(
    new NextRequest('http://localhost/api/payments/oxygen/workflows/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: '60000000-0000-4000-8000-000000000001',
        idempotencyKey: '60000000-0000-4000-8000-000000000002',
        version: 1,
        command: { action: 'resend_customer_otp' },
      }),
    })
  );
  expect(result.status).toBe(429);
  expect(m.rate).toHaveBeenLastCalledWith(
    'oxygen-provider-action:resend_customer_otp',
    { requests: 6, windowMs: 60_000 }
  );
  expect(m.connect).not.toHaveBeenCalled();
});

it('returns only a static safe statement code for the known rejected booking', async () => {
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  m.connect.mockReturnValue({
    worker: vi.fn(),
    provider: {},
    partnerReference: 'partner',
    hosts: new Set(),
  });
  m.perform.mockRejectedValue(
    new OxygenProviderFailure('rejected', 'OXYGEN_STATEMENT_REQUIRED')
  );
  const response = await POST(
    new NextRequest('http://localhost/api/payments/oxygen/workflows/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: '60000000-0000-4000-8000-000000000001',
        idempotencyKey: '60000000-0000-4000-8000-000000000002',
        version: 1,
        command: { action: 'book', equityPercentage: 25, tenure: 3 },
      }),
    })
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code: 'OXYGEN_STATEMENT_REQUIRED',
    error:
      'Oxygen needs a valid bank statement before it can prepare your payment plan. Please contact support to complete the bank statement step. Your application is saved.',
  });
});
it('returns static invalid-code copy for the known rejected OTP without raw provider details', async () => {
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  m.connect.mockReturnValue({
    worker: vi.fn(),
    provider: {},
    partnerReference: 'partner',
    hosts: new Set(),
  });
  m.perform.mockRejectedValue(
    new OxygenProviderFailure('rejected', 'OXYGEN_OTP_INVALID')
  );
  const response = await POST(
    new NextRequest('http://localhost/api/payments/oxygen/workflows/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: '60000000-0000-4000-8000-000000000001',
        idempotencyKey: '60000000-0000-4000-8000-000000000002',
        version: 1,
        command: { action: 'validate_customer', otp: '123456' },
      }),
    })
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code: 'OXYGEN_OTP_INVALID',
    error: 'That code isn’t valid. Check the six digits or request a new code.',
  });
});

it('returns only a static safe active-loan code for the known rejected booking', async () => {
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  m.connect.mockReturnValue({
    worker: vi.fn(),
    provider: {},
    partnerReference: 'partner',
    hosts: new Set(),
  });
  m.perform.mockRejectedValue(
    new OxygenProviderFailure('rejected', 'OXYGEN_ACTIVE_LOAN')
  );
  const response = await POST(
    new NextRequest('http://localhost/api/payments/oxygen/workflows/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: '60000000-0000-4000-8000-000000000001',
        idempotencyKey: '60000000-0000-4000-8000-000000000002',
        version: 1,
        command: { action: 'book', equityPercentage: 25, tenure: 3 },
      }),
    })
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code: 'OXYGEN_ACTIVE_LOAN',
    error:
      'Oxygen says you already have an active loan. Please contact support for help continuing your application. Your progress is saved.',
  });
});
