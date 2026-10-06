import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolvePiggyvestCustomerPolicyContext as resolve } from './customer-policy-context';

const merchantId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const goalId = 'abcdefab-4444-4444-8444-444444444444';
const configuration = {
  environment: 'staging',
  transport: 'local_test',
  integrationId: '77777777-7777-4777-8777-777777777777',
  expectedBusinessId: 'synthetic-business',
  merchantId,
  allowlistedMerchantIds: [merchantId],
  allowlistedCustomerIds: [customerId],
  expectedProjectId: 'synthetic',
  actualProjectId: 'synthetic',
};
const rows = [
  { id: merchantId },
  { id: customerId, merchant_id: merchantId, user_id: actorId },
  { id: goalId, merchant_id: merchantId, customer_id: customerId },
];

function fixture(changedRows: unknown[] = rows) {
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  const maybeSingle = vi.fn();
  for (const data of changedRows)
    maybeSingle.mockResolvedValueOnce({ data, error: null });
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  const supabase = { auth: { getUser }, from } as unknown as SupabaseClient;
  return { supabase, getUser, from, query };
}

describe('customer policy identity context', () => {
  it('rejects a linked but nonallowlisted customer before reading the goal', async () => {
    const test = fixture();
    expect(
      await resolve({
        configuration: { ...configuration, allowlistedCustomerIds: [actorId] },
        input: { goalId },
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable' });
    expect(test.from.mock.calls).toEqual([['merchants'], ['customers']]);
  });
  it('authenticates first and derives an exact linked customer store scope', async () => {
    const test = fixture();
    expect(
      await resolve({
        configuration,
        input: { goalId: goalId.toUpperCase() },
        supabase: test.supabase,
      })
    ).toEqual({
      status: 'ready',
      configuration: {
        environment: 'staging',
        integrationId: configuration.integrationId,
        expectedBusinessId: configuration.expectedBusinessId,
        merchantId,
        customerId,
        goalId,
      },
      actorId,
    });
    expect(test.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      test.from.mock.invocationCallOrder[0]
    );
    expect(test.from.mock.calls).toEqual([
      ['merchants'],
      ['customers'],
      ['customer_savings_goals'],
    ]);
    expect(test.query.select.mock.calls).toEqual([
      ['id'],
      ['id, merchant_id, user_id'],
      ['id, merchant_id, customer_id'],
    ]);
    expect(test.query.eq.mock.calls).toEqual([
      ['id', merchantId],
      ['merchant_id', merchantId],
      ['user_id', actorId],
      ['id', goalId],
      ['merchant_id', merchantId],
      ['customer_id', customerId],
    ]);
  });

  it.each([
    null,
    { id: 'malformed' },
  ])('rejects absent or malformed authentication without reads', async (user) => {
    const test = fixture();
    test.getUser.mockResolvedValue({ data: { user }, error: null });
    expect(
      await resolve({
        configuration,
        input: { goalId },
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable' });
    expect(test.from).not.toHaveBeenCalled();
  });

  it.each([
    { environment: 'production' },
    { transport: 'tls' },
    { actualProjectId: 'another' },
    { allowlistedMerchantIds: [] },
    { allowlistedMerchantIds: [customerId] },
    { expectedBusinessId: '' },
    { integrationId: 'bad' },
  ])('denies invalid trusted configuration %j after auth without table reads', async (change) => {
    const test = fixture();
    expect(
      await resolve({
        configuration: { ...configuration, ...change },
        input: { goalId },
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable' });
    expect(test.getUser).toHaveBeenCalledOnce();
    expect(test.from).not.toHaveBeenCalled();
  });

  it.each([
    { goalId: 'bad' },
    { goalId, customerId },
    { goalId, actorId },
    { goalId, email: 'synthetic@example.test' },
  ])('rejects malformed or identity-bearing input %j', async (input) => {
    const test = fixture();
    expect(
      await resolve({ configuration, input, supabase: test.supabase })
    ).toEqual({ status: 'unavailable' });
    expect(test.from).not.toHaveBeenCalled();
  });

  it.each([
    [0, null],
    [0, { id: customerId }],
    [1, null],
    [1, { ...rows[1], merchant_id: customerId }],
    [1, { ...rows[1], user_id: customerId }],
    [1, { ...rows[1], id: 'bad' }],
    [2, null],
    [2, { ...rows[2], merchant_id: customerId }],
    [2, { ...rows[2], customer_id: actorId }],
    [2, { ...rows[2], id: actorId }],
  ])('fails closed for missing/mismatched row %j %j', async (index, row) => {
    const changed: unknown[] = [...rows];
    changed[Number(index)] = row;
    const test = fixture(changed);
    expect(
      await resolve({
        configuration,
        input: { goalId },
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable' });
    expect(test.from).toHaveBeenCalledTimes(Number(index) + 1);
  });

  it.each([
    0, 1, 2,
  ])('redacts database errors at read %i even with valid data', async (index) => {
    const test = fixture([]);
    rows.forEach((data, position) => {
      test.query.maybeSingle.mockResolvedValueOnce({
        data,
        error: position === index ? { message: 'private detail' } : null,
      });
    });
    expect(
      await resolve({
        configuration,
        input: { goalId },
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable' });
  });

  it('redacts thrown auth failures and never logs raw data', async () => {
    const test = fixture();
    test.getUser.mockRejectedValue(new Error('private auth detail'));
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(
        await resolve({
          configuration,
          input: { goalId },
          supabase: test.supabase,
        })
      ).toEqual({ status: 'unavailable' });
      expect(logger).not.toHaveBeenCalled();
      expect(test.from).not.toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });
});
