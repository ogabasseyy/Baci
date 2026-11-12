import { describe, expect, it, vi } from 'vitest';
import type { PiggyvestIntakeClient } from '@/lib/piggyvest/intake-client.types';
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
  details: {
    pvb_reference: 'PVB01INBOX001',
    transaction_id: 'transaction-001',
  },
};
const storedEnvelope = {
  event_type: input.eventType,
  event_category: input.eventCategory,
  customer_id: input.customerId,
  wallet_id: null,
  reference: null,
  amount_kobo: null,
  event_details: input.details,
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
    } as unknown as PiggyvestIntakeClient,
    rpc,
    query,
  };
}

describe('recordPiggyvestEvent', () => {
  it.each([
    ['PVB01INBOX001', 'duplicate'],
    ['PVB01INBOX002', 'conflict'],
    [undefined, 'conflict'],
  ])('binds reused interest event IDs to stored pvb_reference %s', async (storedReference, outcome) => {
    const payout = {
      ...input,
      eventType: 'interest-payout.success',
      eventCategory: 'interest_payout',
      details: { pvb_reference: 'PVB01INBOX001', payout_id: 'payout-001' },
    };
    const { client } = mockClient([], null, {
      ...storedEnvelope,
      event_type: payout.eventType,
      event_category: payout.eventCategory,
      event_details: {
        pvb_reference: storedReference,
        payout_id: 'payout-001',
      },
    });
    await expect(recordPiggyvestEvent(client, payout)).resolves.toBe(outcome);
  });
  it('rejects reused event IDs with a different pvb_reference', async () => {
    const { client } = mockClient([]);
    await expect(
      recordPiggyvestEvent(client, {
        ...input,
        details: { pvb_reference: 'PVB01INBOX002' },
      })
    ).resolves.toBe('conflict');
  });
  it('fails closed when neither the stored details nor the row carry pvb_reference', async () => {
    const { client } = mockClient([], null, {
      ...storedEnvelope,
      event_details: null,
    });
    await expect(recordPiggyvestEvent(client, input)).resolves.toBe('conflict');
  });
  describe('bugfix: a same-event retry with changed money fields was a duplicate', () => {
    it.each([
      [
        'bank-transfer.inflow.success',
        'bank-transfer',
        { fee: 50 },
        { fee: 75 },
      ],
      [
        'interest-payout.success',
        'interest_payout',
        { gross_interest_payout: 100, withholding_tax: 10 },
        { gross_interest_payout: 110, withholding_tax: 20 },
      ],
    ])('%s conflicts when a stored money field differs', async (eventType, eventCategory, storedMoney, incomingMoney) => {
      const { client } = mockClient([], null, {
        ...storedEnvelope,
        event_type: eventType,
        event_category: eventCategory,
        event_details: { pvb_reference: 'PVB01INBOX001', ...storedMoney },
      });
      await expect(
        recordPiggyvestEvent(client, {
          ...input,
          eventType,
          eventCategory,
          details: { pvb_reference: 'PVB01INBOX001', ...incomingMoney },
        })
      ).resolves.toBe('conflict');
    });
  });
  describe('bugfix: same-event retry with a rotated internal id was quarantined', () => {
    it.each([
      ['bank-transfer.inflow.success', 'bank-transfer', 'transaction_id'],
      ['interest-payout.success', 'interest_payout', 'payout_id'],
    ])('%s with the same pvb_reference and a new %s is a duplicate', async (eventType, eventCategory, idField) => {
      const { client } = mockClient([], null, {
        ...storedEnvelope,
        event_type: eventType,
        event_category: eventCategory,
        event_details: {
          pvb_reference: 'PVB01INBOX001',
          [idField]: 'internal-1',
        },
      });
      await expect(
        recordPiggyvestEvent(client, {
          ...input,
          eventType,
          eventCategory,
          details: { pvb_reference: 'PVB01INBOX001', [idField]: 'internal-2' },
        })
      ).resolves.toBe('duplicate');
    });
    it('falls back to the stored reference column for older rows', async () => {
      const { client } = mockClient([], null, {
        ...storedEnvelope,
        reference: 'PVB01INBOX001',
        event_details: { transaction_id: 'transaction-001' },
      });
      await expect(
        recordPiggyvestEvent(client, { ...input, reference: 'PVB01INBOX001' })
      ).resolves.toBe('duplicate');
    });
  });
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
