import type { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { runAmendmentCommand } from './command';

const { authenticate, rpc } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: authenticate }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
}));
vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn(async () => true),
}));

it('rejects an invalid order identifier before dispatching an amendment read', async () => {
  authenticate.mockResolvedValueOnce({
    user: { id: 'fixture' },
    supabase: { rpc },
  });
  const request = new Request(
    'https://test.invalid/api/orders/invalid/amendments'
  ) as NextRequest;

  const response = await runAmendmentCommand(
    request,
    {
      params: Promise.resolve({ id: 'invalid' }),
    },
    'read'
  );

  expect(response.status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it('uses payment-neutral copy for staff tender conflicts', async () => {
  authenticate.mockResolvedValueOnce({
    user: { id: 'fixture' },
    supabase: {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'staff_pos_receipt_used' },
      }),
    },
  });
  const request = new Request(
    'https://test.invalid/api/orders/order-1/amendments',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        previewId: '27d8f290-4b21-4e4e-8e3f-83aa09b64ca8',
        idempotencyKey: '1a3f2a9a-ea6c-4a85-b150-2e7fbec5916d',
        reason: 'Customer requested a replacement',
        customerAgreed: true,
        staffTopUp: { method: 'cash' },
      }),
    }
  ) as NextRequest;

  const response = await runAmendmentCommand(
    request,
    { params: Promise.resolve({ id: '6ba7b810-9dad-41d1-80b4-00c04fd430c8' }) },
    'confirm'
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code: 'staff_pos_receipt_used',
    error:
      'This staff-recorded payment conflicts with an existing payment entry.',
  });
});
