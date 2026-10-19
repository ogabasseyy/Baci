import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { buildStoredAgenticIdempotencyResponse } from '@/lib/agentic/idempotency-response-storage';
import {
  CHECKOUT_SESSION_UPDATE_IDEMPOTENCY_ROUTE,
  reserveCheckoutSessionUpdateIdempotency,
} from './checkout-session-update-idempotency';

const mockReserve = vi.hoisted(() => vi.fn());
const mockBuildStored = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agentic/idempotency', () => ({
  IDEMPOTENCY_PARAMETER_MISMATCH_ERROR:
    'Idempotency key reused with different request parameters',
  IDEMPOTENCY_REQUEST_IN_PROGRESS_ERROR: 'Idempotency request in progress',
  IDEMPOTENCY_RESERVATION_FAILED_ERROR: 'Idempotency reservation failed',
  IDEMPOTENCY_TRANSIENT_LOOKUP_ERROR: 'Idempotency transient lookup error',
  reserveAgenticIdempotencyKey: mockReserve,
}));
vi.mock('@/lib/agentic/idempotency-response-storage', () => ({
  buildStoredAgenticIdempotencyResponse: mockBuildStored,
}));

const INPUT = {
  agentId: 'agent-1',
  apiVersion: '2026-04-01',
  idempotencyKey: 'idem-key-1',
  merchantId: '11111111-1111-4111-8111-111111111111',
  method: 'POST',
  pathname: '/api/agentic/checkout_sessions/session-1',
  rawBody: '{"status":"complete"}',
  requestId: 'req-1',
  supabase: {} as never,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reserveCheckoutSessionUpdateIdempotency', () => {
  it('maps a reservation failure to its status response', async () => {
    mockReserve.mockResolvedValue({
      ok: false,
      error: 'Idempotency key reused with different request parameters',
    });

    const result = await reserveCheckoutSessionUpdateIdempotency(INPUT);

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') throw new Error('expected failure');
    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toEqual({
      error: 'Idempotency key reused with different request parameters',
    });
    expect(mockReserve).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        body: INPUT.rawBody,
        key: 'idem-key-1',
        route: CHECKOUT_SESSION_UPDATE_IDEMPOTENCY_ROUTE,
      })
    );
  });

  it('replays the stored response with idempotency headers', async () => {
    mockReserve.mockResolvedValue({
      ok: true,
      state: 'replay',
      requestHash: 'hash-1',
      response: { id: 'session-1', status: 'complete' },
      status: 201,
    });

    const result = await reserveCheckoutSessionUpdateIdempotency(INPUT);

    expect(result.kind).toBe('replay');
    if (result.kind !== 'replay') throw new Error('expected replay');
    expect(result.response.status).toBe(201);
    expect(result.response.headers.get('idempotency-key')).toBe('idem-key-1');
    expect(result.response.headers.get('request-id')).toBe('req-1');
    expect(await result.response.json()).toEqual({
      id: 'session-1',
      status: 'complete',
    });
    expect(mockBuildStored).not.toHaveBeenCalled();
  });

  it('wires the reserved responder to stored-response persistence', async () => {
    mockReserve.mockResolvedValue({ ok: true, state: 'reserved' });
    mockBuildStored.mockImplementation(
      async (input: { response: unknown; status: number }) =>
        NextResponse.json(input.response as Record<string, unknown>, {
          status: input.status,
        })
    );

    const result = await reserveCheckoutSessionUpdateIdempotency(INPUT);

    expect(result.kind).toBe('reserved');
    if (result.kind !== 'reserved') throw new Error('expected reserved');
    const response = await result.respond({ id: 'session-1' }, 200);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'session-1' });
    expect(mockBuildStored).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        idempotencyKey: 'idem-key-1',
        merchantId: INPUT.merchantId,
        requestId: 'req-1',
        response: { id: 'session-1' },
        route: CHECKOUT_SESSION_UPDATE_IDEMPOTENCY_ROUTE,
        status: 200,
        storageFailureResponse: { error: 'Internal Server Error' },
      })
    );
    // Silence unused-import lint for the direct mock handles.
    expect(reserveAgenticIdempotencyKey).toBe(mockReserve);
    expect(buildStoredAgenticIdempotencyResponse).toBe(mockBuildStored);
  });
});
