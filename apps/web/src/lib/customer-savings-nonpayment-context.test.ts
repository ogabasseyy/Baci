import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { resolveCustomerSavingsNonpaymentContext } from './customer-savings-nonpayment-context';

vi.mock('./with-merchant-slug-alias-fallback', () => ({
  withMerchantSlugAliasFallback: async (
    slug: string,
    lookup: (value: string) => Promise<unknown>
  ) => lookup(slug),
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const merchant = { id: merchantId, slug: 'ogabassey' };
const customer = { id: customerId, merchant_id: merchantId, user_id: actorId };

function fixture(
  merchantResult = { data: merchant as unknown, error: null as unknown },
  customerResult = { data: customer as unknown, error: null as unknown }
) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValueOnce(merchantResult)
    .mockResolvedValueOnce(customerResult);
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  const supabase = { from } as unknown as SupabaseClient;
  return { supabase, from, query };
}

describe('nonpayment authenticated savings context', () => {
  it('resolves merchant then the already-linked customer on the supplied RLS client', async () => {
    const test = fixture();
    const result = await resolveCustomerSavingsNonpaymentContext({
      identifiers: { merchantId },
      supabase: test.supabase,
      user: { id: actorId },
    });
    expect(result).toEqual({ merchant, customer, supabase: test.supabase });
    expect(test.from.mock.calls).toEqual([['merchants'], ['customers']]);
    expect(test.query.select.mock.calls).toEqual([
      ['id, slug'],
      ['id, merchant_id, user_id'],
    ]);
    expect(test.query.eq.mock.calls).toEqual([
      ['id', merchantId],
      ['user_id', actorId],
      ['merchant_id', merchantId],
    ]);
  });
  it('supports slug-only identity without fetching payment settings or secrets', async () => {
    const test = fixture();
    expect(
      await resolveCustomerSavingsNonpaymentContext({
        identifiers: { merchantSlug: 'ogabassey' },
        supabase: test.supabase,
        user: { id: actorId },
      })
    ).toEqual({ merchant, customer, supabase: test.supabase });
    expect(test.query.eq).toHaveBeenCalledWith('slug', 'ogabassey');
  });
  it.each([
    { user: { id: '' }, identifiers: { merchantId }, status: 401 },
    { user: { id: actorId }, identifiers: {}, status: 400 },
  ])('rejects invalid auth/input before database access', async ({
    user,
    identifiers,
    status,
  }) => {
    const test = fixture();
    const result = await resolveCustomerSavingsNonpaymentContext({
      user,
      identifiers,
      supabase: test.supabase,
    });
    expect('response' in result && result.response.status).toBe(status);
    expect(test.from).not.toHaveBeenCalled();
  });
  it('returns not found when merchant is absent or hidden by RLS', async () => {
    const test = fixture({ data: null, error: null });
    const result = await resolveCustomerSavingsNonpaymentContext({
      identifiers: { merchantId },
      user: { id: actorId },
      supabase: test.supabase,
    });
    expect('response' in result && result.response.status).toBe(404);
    expect(test.from).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    { ...customer, user_id: null },
    { ...customer, user_id: customerId },
    { ...customer, merchant_id: customerId },
  ])('fails closed on unlinked or mismatched customer without email fallback or writes', async (data) => {
    const test = fixture(undefined, { data, error: null });
    const result = await resolveCustomerSavingsNonpaymentContext({
      identifiers: { merchantId },
      user: { id: actorId },
      supabase: test.supabase,
    });
    expect('response' in result && result.response.status).toBe(404);
    expect(test.from.mock.calls).toEqual([['merchants'], ['customers']]);
    expect(test.query.eq.mock.calls).toEqual([
      ['id', merchantId],
      ['user_id', actorId],
      ['merchant_id', merchantId],
    ]);
  });
  it.each([
    'merchant',
    'customer',
  ])('redacts %s lookup errors and stops resolution', async (stage) => {
    const failed = {
      data: null,
      error: { message: 'sensitive database detail' },
    };
    const test = fixture(
      stage === 'merchant' ? failed : undefined,
      stage === 'customer' ? failed : undefined
    );
    const result = await resolveCustomerSavingsNonpaymentContext({
      identifiers: { merchantId },
      user: { id: actorId },
      supabase: test.supabase,
    });
    expect('response' in result && result.response.status).toBe(500);
    if ('response' in result)
      expect(JSON.stringify(await result.response.json())).not.toContain(
        'sensitive'
      );
    expect(test.from).toHaveBeenCalledTimes(stage === 'merchant' ? 1 : 2);
  });
});
