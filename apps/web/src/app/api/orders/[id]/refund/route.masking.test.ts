import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));

import { GET } from './route';

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
describe('order refund route', () => {
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
  it('replaces an unknown summary error with the generic label', async () => {
    // A mapper regression or a reachable legacy row must never leak
    // worker internals through the success shape.
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'failed',
        error: 'Paystack/insufficient-balance (acquirer 51)',
      },
      error: null,
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'failed',
      error: 'The refund ran into a problem. Support has the details.',
      events: [],
      eventsTruncated: false,
      history: [],
      historyTruncated: false,
      legs: [],
      needsPaystackCheck: false,
    });
  });
  it('masks raw worker text inside audit event details', async () => {
    // The timeline renders details.error directly: a legacy or
    // backfilled event row that predates the write-time mapper must
    // reach the client as the generic label, with unknown detail
    // keys dropped — mapped labels and counters pass through.
    // Actor UUIDs and recorder identities are dropped with the same
    // stroke: view-only staff have no operational need for peer
    // identity, and nothing renders them.
    mocks.rpc.mockResolvedValue({
      data: {
        error: null,
        events: [
          {
            action: 'failed',
            actor: '9ef40000-0000-4000-8000-000000000001',
            details: {
              attempts: 3,
              error: 'Paystack/insufficient-balance (acquirer 51)',
              previousError:
                'Refund in progress — queued to resume automatically.',
              raw_sqlstate: 'P0001',
            },
          },
        ],
        history: [
          {
            amount: 10,
            date: '2026-09-28T12:00:00Z',
            id: 7,
            method: 'bank_transfer',
            recorded_by: '9ef40000-0000-4000-8000-000000000001',
            reference: 'bank-1',
            status: 'completed',
          },
        ],
        status: 'failed',
      },
      error: null,
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      error: null,
      events: [
        {
          action: 'failed',
          details: {
            attempts: 3,
            error: 'The refund ran into a problem. Support has the details.',
            previousError:
              'Refund in progress — queued to resume automatically.',
          },
        },
      ],
      history: [
        {
          amount: 10,
          date: '2026-09-28T12:00:00Z',
          id: 7,
          method: 'bank_transfer',
          reference: 'bank-1',
          status: 'completed',
        },
      ],
      eventsTruncated: false,
      historyTruncated: false,
      legs: [],
      needsPaystackCheck: false,
      status: 'failed',
    });
  });
  it('drops unknown top-level keys from the success shape', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'failed',
        error: null,
        stepStatus: 'failed',
      },
      error: null,
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'failed',
      error: null,
      events: [],
      eventsTruncated: false,
      history: [],
      historyTruncated: false,
      legs: [],
      needsPaystackCheck: false,
    });
  });
});
