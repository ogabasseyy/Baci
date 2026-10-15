import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));

import { POST } from './route';

const id = '7343de92-de96-4a0f-a3c0-2344aeb5b008';
const context = { params: Promise.resolve({ id }) };
function request(body?: unknown) {
  return new NextRequest(`https://example.com/api/orders/${id}/refund`, {
    method: body ? 'POST' : 'GET',
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        }
      : {}),
  });
}
describe('order refund route error mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: 'owner' },
      supabase: { rpc: mocks.rpc },
      error: null,
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.rpc.mockResolvedValue({ data: { status: 'failed' }, error: null });
  });
  it.each([
    [
      '42501',
      403,
      'refund_forbidden',
      'You do not have permission to manage this refund',
    ],
    ['28000', 401, 'not_authenticated', 'Authentication required'],
    ['P0002', 404, 'order_not_found', 'Order not found'],
    [
      'P0001',
      409,
      'refund_processing_or_requires_review',
      'Refund is processing or requires review',
    ],
    [
      'P0001',
      409,
      'manual_completion_required',
      'Finish the remaining balance as a manual refund before retrying',
    ],
    [
      'P0001',
      422,
      'cancelled_paid_order_required',
      'Refunds require a cancelled, paid order',
    ],
    [
      'P0001',
      422,
      'failed_refund_required',
      'Only a failed refund can be retried',
    ],
    [
      'P0001',
      422,
      'refund_exceeds_remaining',
      'Refund amount exceeds the remaining balance',
    ],
    ['P0001', 400, 'invalid_manual_refund', 'Invalid manual refund request'],
    ['P0001', 400, 'invalid_refund_action', 'Invalid refund request'],
    [
      'P0001',
      400,
      'refund_confirmation_required',
      'Confirm that the money already moved before recording',
    ],
    [
      'P0001',
      409,
      'already_refunded',
      'This order has already been fully refunded',
    ],
    [
      'P0001',
      409,
      'manual_reference_conflict',
      'This reference was already used for a different refund',
    ],
    ['P0001', 404, 'order_not_found', 'Order not found'],
    ['P0001', 500, 'internal_detail', 'Unable to manage refund'],
    ['unexpected', 500, 'internal_detail', 'Unable to manage refund'],
    ['P0001', 429, 'retry_too_soon', 'Please wait a minute before retrying'],
  ])('maps database %s errors to %s without echoing raw text', async (code, status, message, expectedError) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code, message },
    });
    const response = await POST(request({ action: 'retry' }), context);
    expect(response.status).toBe(status);
    // The response carries the application-level code, never the raw
    // SQLSTATE, so database error classes are not fingerprinted.
    const expectedCode =
      message === 'internal_detail' ? 'internal_error' : message;
    expect(await response.json()).toEqual({
      error: expectedError,
      code: expectedCode,
    });
  });
  it('keeps the code when drivers wrap a known failure message', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message:
          'manual_completion_required: finish the balance first (context: rpc manage_order_refund)',
      },
    });
    const response = await POST(request({ action: 'retry' }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Finish the remaining balance as a manual refund before retrying',
      code: 'manual_completion_required',
    });
  });
  it('matches a known failure even when a wrapper uppercases it', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'MANUAL_COMPLETION_REQUIRED: FINISH THE BALANCE FIRST',
      },
    });
    const response = await POST(request({ action: 'retry' }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Finish the remaining balance as a manual refund before retrying',
      code: 'manual_completion_required',
    });
  });
  it('does not match a known token embedded in a larger word', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message:
          'duplicate key value violates constraint "ck_manual_reference_conflict_seen"',
      },
    });
    const response = await POST(request({ action: 'retry' }), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Unable to manage refund',
      code: 'internal_error',
    });
  });
  it('ignores known tokens echoed by non-application errors', async () => {
    // A constraint message echoing a merchant-controlled value that
    // contains a known token must not be mistaken for the
    // application state it names.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "already_refunded#1_ref"',
      },
    });
    const response = await POST(request({ action: 'retry' }), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Unable to manage refund',
      code: 'internal_error',
    });
  });
  it('leaves unexpected unique violations as internal errors', async () => {
    // The RPC converts its own reference race; a residual 23505 is
    // genuinely unexpected and must not masquerade as a conflict.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "other_uidx"',
      },
    });
    const response = await POST(
      request({
        action: 'manual',
        amount: 10,
        refundedAt: '2026-09-28T12:00:00Z',
        reference: 'bank-1',
        method: 'bank_transfer',
        confirmed: true,
      }),
      context
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Unable to manage refund',
      code: 'internal_error',
    });
  });
});
