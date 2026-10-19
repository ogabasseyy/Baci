import { describe, expect, it, vi } from 'vitest';
import {
  claimCompletedLegacyIdempotencyRecord,
  verifyLegacyIdempotencyOwnership,
} from '@/lib/agentic/idempotency-legacy';

describe('idempotency-legacy', () => {
  it('verifies legacy ownership directly from response_body agent_id when present', async () => {
    const from = vi.fn();
    const matched = await verifyLegacyIdempotencyOwnership({
      callerScope: 'agent-a',
      key: 'idem-1',
      merchantId: 'merchant-1',
      record: {
        request_hash: 'hash-1',
        response_body: { agent_id: 'agent-a', id: 'session-1' },
        status_code: 201,
      },
      route: 'checkout_sessions.create',
      supabase: { from } as never,
    });
    expect(matched).toEqual({ verified: true });
    expect(from).not.toHaveBeenCalled();

    const mismatched = await verifyLegacyIdempotencyOwnership({
      callerScope: 'agent-b',
      key: 'idem-1',
      merchantId: 'merchant-1',
      record: {
        request_hash: 'hash-1',
        response_body: { agent_id: 'agent-a', id: 'session-1' },
        status_code: 201,
      },
      route: 'checkout_sessions.create',
      supabase: { from } as never,
    });
    expect(mismatched).toEqual({ verified: false });
  });

  it('verifies legacy ownership against agentic_request_records when response_body has no agent_id', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ agent_id: 'agent-a' }],
      error: null,
    });
    const eqChain = {
      eq: vi.fn(),
      limit,
    };
    eqChain.eq.mockReturnValue(eqChain);
    const from = vi.fn(() => ({
      select: vi.fn(() => eqChain),
    }));

    const verified = await verifyLegacyIdempotencyOwnership({
      callerScope: 'agent-a',
      key: 'idem-1',
      merchantId: 'merchant-1',
      record: {
        request_hash: 'hash-1',
        response_body: { id: 'session-1' },
        status_code: 201,
      },
      route: 'checkout_sessions.create',
      supabase: { from } as never,
    });
    expect(verified).toEqual({ verified: true });

    const denied = await verifyLegacyIdempotencyOwnership({
      callerScope: 'agent-b',
      key: 'idem-1',
      merchantId: 'merchant-1',
      record: {
        request_hash: 'hash-1',
        response_body: { id: 'session-1' },
        status_code: 201,
      },
      route: 'checkout_sessions.create',
      supabase: { from } as never,
    });
    expect(denied).toEqual({ verified: false });
  });

  it('atomically claims a completed legacy unscoped record for the caller scope', async () => {
    const claimed = {
      request_hash: 'hash-1',
      response_body: { id: 'session-1' },
      status_code: 201,
      updated_at: '2026-04-30T12:00:00.000Z',
    };
    const eq = vi.fn();
    const chain = {
      eq,
      maybeSingle: vi.fn().mockResolvedValue({ data: claimed, error: null }),
      select: vi.fn(),
    };
    eq.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    const update = vi.fn(() => chain);
    const from = vi.fn(() => ({ update }));

    const result = await claimCompletedLegacyIdempotencyRecord({
      callerScope: 'agent-a',
      key: 'idem-1',
      merchantId: 'merchant-1',
      requestHash: 'hash-1',
      route: 'checkout_sessions.create',
      statusCode: 201,
      supabase: { from } as never,
    });

    expect(result).toEqual({ record: claimed });
    expect(update).toHaveBeenCalledWith({ agent_id: 'agent-a' });
    expect(eq).toHaveBeenCalledWith('agent_id', '');
  });
});
