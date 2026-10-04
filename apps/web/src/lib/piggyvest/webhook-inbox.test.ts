import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  claimPiggyvestEvent,
  recordPiggyvestEvent,
  resolvePiggyvestEvent,
} from './webhook-inbox';

const claimToken = '4204dc18-efb3-44d0-b9a2-1362448d4f21';
const input = {
  eventId: 'event-001',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'bank-transfer',
  customerId: 'customer-001',
};
const storedEnvelope = {
  event_type: input.eventType,
  event_category: input.eventCategory,
  customer_id: input.customerId,
  wallet_id: null,
  reference: null,
  amount_kobo: null,
};

function mockClient(
  data: unknown,
  error: unknown = null,
  existing: unknown = storedEnvelope
) {
  const query = {
    upsert: vi.fn().mockReturnThis(),
    // select() is both awaitable (upsert result) and chainable (verify
    // read via .eq().maybeSingle()).
    select: vi.fn(() =>
      Object.assign(Promise.resolve({ data, error }), {
        eq: vi.fn(() => ({
          maybeSingle: async () => ({ data: existing, error: null }),
        })),
      })
    ),
  };
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    client: {
      from: () => query,
      rpc,
    } as unknown as PiggyvestIntakeServiceClient,
    rpc,
    query,
  };
}

describe('recordPiggyvestEvent', () => {
  it.each([
    [[{ event_id: input.eventId }], 'new'],
    [[], 'duplicate'],
  ] as const)('retains duplicate receipts without overwriting processing state: %j', async (data, outcome) => {
    const { client, query } = mockClient(data);
    await expect(recordPiggyvestEvent(client, input)).resolves.toBe(outcome);
    expect(query.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: input.eventId }),
      { onConflict: 'event_id', ignoreDuplicates: true }
    );
  });
  it('flags same-identity different-content redeliveries as conflicts', async () => {
    const { client } = mockClient([], null, {
      ...storedEnvelope,
      amount_kobo: 999,
    });
    await expect(recordPiggyvestEvent(client, input)).resolves.toBe('conflict');
  });
  it('throws on persistence failure', async () => {
    const { client } = mockClient(null, { message: 'unavailable' });
    await expect(recordPiggyvestEvent(client, input)).rejects.toThrow(
      'unavailable'
    );
  });
});

describe('claimPiggyvestEvent', () => {
  it('returns the ownership token for a database lease', async () => {
    const { client, rpc } = mockClient({
      outcome: 'claimed',
      claim_token: claimToken,
    });
    await expect(claimPiggyvestEvent(client, input.eventId)).resolves.toEqual({
      outcome: 'claimed',
      claimToken,
    });
    expect(rpc).toHaveBeenCalledWith('claim_piggyvest_webhook_event', {
      p_event_id: input.eventId,
    });
  });
  it.each([
    'busy',
    'processed',
  ])('distinguishes %s without ownership', async (outcome) => {
    const { client } = mockClient({ outcome, claim_token: null });
    await expect(claimPiggyvestEvent(client, input.eventId)).resolves.toEqual({
      outcome,
    });
  });
  it.each([
    null,
    [],
    true,
    {},
    { outcome: 'missing' },
    { outcome: 'claimed' },
    { outcome: 'claimed', claim_token: null },
    { outcome: 'claimed', claim_token: 'invalid' },
  ])('fails closed for malformed RPC output %j', async (data) => {
    const { client } = mockClient(data);
    await expect(claimPiggyvestEvent(client, input.eventId)).rejects.toThrow();
  });
  it('throws on claim storage errors', async () => {
    const { client } = mockClient(null, { message: 'unavailable' });
    await expect(claimPiggyvestEvent(client, input.eventId)).rejects.toThrow(
      'unavailable'
    );
  });
  it('validates identity before calling the database', async () => {
    const { client, rpc } = mockClient(null);
    await expect(claimPiggyvestEvent(client, '')).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('resolvePiggyvestEvent', () => {
  it.each([
    'processed',
    'failed',
  ] as const)('fences %s with the exact ownership token', async (status) => {
    const { client, rpc } = mockClient(true);
    await resolvePiggyvestEvent(client, {
      eventId: input.eventId,
      claimToken,
      status,
    });
    expect(rpc).toHaveBeenCalledWith('resolve_piggyvest_webhook_event', {
      p_event_id: input.eventId,
      p_claim_token: claimToken,
      p_status: status,
      p_last_error: null,
    });
  });
  it.each([
    false,
    null,
    undefined,
    [],
    'true',
  ])('rejects unconfirmed completion %j', async (data) => {
    const { client } = mockClient(data);
    await expect(
      resolvePiggyvestEvent(client, {
        eventId: input.eventId,
        claimToken,
        status: 'processed',
      })
    ).rejects.toThrow('lease lost');
  });
  it('throws on resolution storage errors', async () => {
    const { client } = mockClient(null, { message: 'unavailable' });
    await expect(
      resolvePiggyvestEvent(client, {
        eventId: input.eventId,
        claimToken,
        status: 'failed',
      })
    ).rejects.toThrow('unavailable');
  });
  it('rejects oversized failure detail before persistence', async () => {
    const { client, rpc } = mockClient(true);
    await expect(
      resolvePiggyvestEvent(client, {
        eventId: input.eventId,
        claimToken,
        status: 'failed',
        lastError: 'x'.repeat(501),
      })
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
