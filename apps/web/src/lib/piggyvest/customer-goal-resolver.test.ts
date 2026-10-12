import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolvePiggyvestCustomerGoal } from './customer-goal-resolver';

const merchantId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const goalId = '44444444-4444-4444-8444-444444444444';
const productId = '55555555-5555-4555-8555-555555555555';
const variantId = '66666666-6666-4666-8666-666666666666';
const configuration = {
  environment: 'staging',
  integrationId: '77777777-7777-4777-8777-777777777777',
  merchantId,
  expectedProjectId: 'synthetic',
  actualProjectId: 'synthetic',
  allowlistedCustomerIds: [customerId],
};
const scope = { customerId, goalId };
const goal = {
  id: goalId,
  merchant_id: merchantId,
  customer_id: customerId,
  product_id: productId,
  variant_id: variantId,
  status: 'completed',
  product_snapshot: {
    name: 'Stored phone',
    variantId,
    variantLabel: '256GB',
    condition: 'new',
    selectionStatus: 'exact',
    price: 100,
  },
  terms_accepted_at: '2026-09-01T10:00:00Z',
  non_withdrawable_accepted_at: '2026-09-01T10:00:00Z',
  early_end_fee_accepted_at: null,
};

function fixture(changedGoal: unknown = goal) {
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  const maybeSingle = vi
    .fn()
    .mockResolvedValueOnce({ data: { id: merchantId }, error: null })
    .mockResolvedValueOnce({
      data: { id: customerId, merchant_id: merchantId, user_id: actorId },
      error: null,
    })
    .mockResolvedValueOnce({ data: changedGoal, error: null });
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  const supabase = { auth: { getUser }, from } as unknown as SupabaseClient;
  return { supabase, getUser, from, query };
}

describe('authenticated persisted PiggyVest goal resolver', () => {
  it('reads exact RLS scope and returns only contract-backed stored device facts with explicit policy gaps', async () => {
    const test = fixture();
    const result = await resolvePiggyvestCustomerGoal({
      configuration,
      scope,
      supabase: test.supabase,
    });
    expect(result).toMatchObject({
      status: 'needs_migration',
      reasons: expect.arrayContaining([
        'versioned_policy_consent',
        'integration_binding',
        'lifecycle_and_price_contract',
      ]),
      device: {
        productId,
        variantId,
        productName: 'Stored phone',
        variant: '256GB',
        condition: 'new',
      },
    });
    expect(test.from.mock.calls).toEqual([
      ['merchants'],
      ['customers'],
      ['customer_savings_goals'],
    ]);
    expect(test.query.eq.mock.calls).toEqual([
      ['id', merchantId],
      ['id', customerId],
      ['merchant_id', merchantId],
      ['user_id', actorId],
      ['id', goalId],
      ['customer_id', customerId],
      ['merchant_id', merchantId],
    ]);
    expect(test.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      test.from.mock.invocationCallOrder[0]
    );
    expect(JSON.stringify(result)).not.toMatch(
      /balance|Kobo|purchasingPower|hasBeforeFundingConsent/
    );
    expect(test.query.select.mock.calls.flat().join(',')).not.toMatch(
      /current_amount|target_amount|metadata|\*/
    );
  });

  it('rejects unauthenticated callers before any table query', async () => {
    const test = fixture();
    test.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(
      await resolvePiggyvestCustomerGoal({
        configuration,
        scope,
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable', reason: 'unauthorized' });
    expect(test.from).not.toHaveBeenCalled();
  });

  it.each([
    { ...goal, merchant_id: actorId },
    { ...goal, customer_id: actorId },
    { ...goal, id: actorId },
    null,
  ])('rejects missing and cross-scope goal rows', async (row) => {
    const test = fixture(row);
    expect(
      await resolvePiggyvestCustomerGoal({
        configuration,
        scope,
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable', reason: 'not_found' });
  });

  it.each([
    null,
    actorId,
  ])('rejects absent or wrong customer user linkage %s', async (userId) => {
    const test = fixture();
    test.query.maybeSingle
      .mockReset()
      .mockResolvedValueOnce({ data: { id: merchantId }, error: null })
      .mockResolvedValueOnce({
        data: {
          id: customerId,
          merchant_id: merchantId,
          user_id: userId === actorId ? goalId : null,
        },
        error: null,
      });
    expect(
      await resolvePiggyvestCustomerGoal({
        configuration,
        scope,
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable', reason: 'not_found' });
    expect(test.from).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...goal, product_snapshot: {} },
    { ...goal, variant_id: null },
    {
      ...goal,
      product_snapshot: { ...goal.product_snapshot, variantId: actorId },
    },
    {
      ...goal,
      product_snapshot: { ...goal.product_snapshot, selectionStatus: 'legacy' },
    },
  ])('requires migration for missing or inconsistent exact selection', async (row) => {
    const test = fixture(row);
    const result = await resolvePiggyvestCustomerGoal({
      configuration,
      scope,
      supabase: test.supabase,
    });
    expect(result).toMatchObject({
      status: 'needs_migration',
      reasons: expect.arrayContaining(['exact_device_snapshot']),
    });
    expect(result).not.toHaveProperty('device');
  });

  it('does not manufacture a variant label for a stored nonvariant selection', async () => {
    const test = fixture({
      ...goal,
      variant_id: null,
      product_snapshot: {
        ...goal.product_snapshot,
        variantId: null,
        variantLabel: null,
      },
    });
    const result = await resolvePiggyvestCustomerGoal({
      configuration,
      scope,
      supabase: test.supabase,
    });
    expect(result).toMatchObject({
      status: 'needs_migration',
      device: { variantId: null, variant: null },
    });
  });

  it.each([
    null,
    'invalid',
    true,
  ])('does not accept malformed legacy consent %s', async (terms) => {
    const test = fixture({ ...goal, terms_accepted_at: terms });
    const result = await resolvePiggyvestCustomerGoal({
      configuration,
      scope,
      supabase: test.supabase,
    });
    expect(result).toMatchObject({
      status: 'needs_migration',
      reasons: expect.arrayContaining(['legacy_consent_record']),
    });
  });

  it('ignores forged policy, consent, guarantee and display labels in caller-writable metadata', async () => {
    const test = fixture({
      ...goal,
      metadata: {
        policyVersion: '2026-09-11',
        hasBeforeFundingConsent: true,
        integrationId: configuration.integrationId,
        productName: 'Forged',
        guarantee: { priceKobo: 1 },
      },
    });
    const result = await resolvePiggyvestCustomerGoal({
      configuration,
      scope,
      supabase: test.supabase,
    });
    expect(result).toMatchObject({
      status: 'needs_migration',
      device: { productName: 'Stored phone' },
    });
    expect(JSON.stringify(result)).not.toMatch(/Forged|guarantee|priceKobo/);
  });

  it.each([
    0, 1, 2,
  ])('fails closed and redacts read failure at stage %s', async (stage) => {
    const test = fixture();
    test.query.maybeSingle.mockReset();
    const rows = [
      { id: merchantId },
      { id: customerId, merchant_id: merchantId, user_id: actorId },
      goal,
    ];
    for (let index = 0; index < stage; index++)
      test.query.maybeSingle.mockResolvedValueOnce({
        data: rows[index],
        error: null,
      });
    test.query.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'private error' },
    });
    expect(
      await resolvePiggyvestCustomerGoal({
        configuration,
        scope,
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable', reason: 'read_error' });
    expect(test.from).toHaveBeenCalledTimes(stage + 1);
  });

  it('rejects nonallowlisted scope and supplied display labels before reading tables', async () => {
    const test = fixture();
    expect(
      await resolvePiggyvestCustomerGoal({
        configuration,
        scope: { ...scope, customerId: actorId },
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable', reason: 'invalid_scope' });
    expect(
      await resolvePiggyvestCustomerGoal({
        configuration,
        scope: { ...scope, productName: 'Supplied' },
        supabase: test.supabase,
      })
    ).toEqual({ status: 'unavailable', reason: 'invalid_scope' });
    expect(test.from).not.toHaveBeenCalled();
  });
});
