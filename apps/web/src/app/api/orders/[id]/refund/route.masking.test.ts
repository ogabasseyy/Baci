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
      needsPaystackCheck: false,
    });
  });
  it('masks raw worker text inside audit event details', async () => {
    // The timeline renders details.error directly: a legacy or
    // backfilled event row that predates the write-time mapper must
    // reach the client as the generic label, with unknown detail
    // keys dropped — mapped labels and counters pass through.
    mocks.rpc.mockResolvedValue({
      data: {
        error: null,
        events: [
          {
            action: 'failed',
            details: {
              attempts: 3,
              error: 'Paystack/insufficient-balance (acquirer 51)',
              previousError:
                'Refund in progress — queued to resume automatically.',
              raw_sqlstate: 'P0001',
            },
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
      needsPaystackCheck: false,
    });
  });
});
