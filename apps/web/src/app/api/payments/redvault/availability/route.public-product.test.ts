import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type PaymentAvailabilityModule =
  typeof import('@/lib/checkout/redvault-payment-availability');

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  policy: vi.fn(),
  createClient: vi.fn(),
  authenticate: vi.fn(),
}));
vi.mock(
  '@/lib/checkout/redvault-payment-availability',
  async (importOriginal) => ({
    ...(await importOriginal<PaymentAvailabilityModule>()),
    getRedvaultPaymentAvailability: mocks.availability,
  })
);
vi.mock('@/lib/checkout/redvault-live-pilot', () => ({
  getRedvaultLivePilotPolicy: mocks.policy,
  REDVAULT_PILOT_USER_ID: 'private-user',
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticate,
}));

import { GET } from './route';

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const productId = '11111111-1111-4111-8111-111111111111';
const row = {
  enabled: true,
  audience: 'public_product_test',
  merchant_id: merchantId,
  product_id: productId,
  expires_at: null,
};
const shape = {
  price: 100,
  has_variants: false,
  inventory_tracking_policy: 'off',
  brand: 'Apple',
  name: 'REDVAULT pilot',
  status: 'active',
};

function request(product: string | null = productId) {
  const query = new URLSearchParams({ merchant_id: merchantId });
  if (product !== null) query.set('product_id', product);
  return new NextRequest(
    `http://localhost/api/payments/redvault/availability?${query}`
  );
}

describe('public product availability DB agreement', () => {
  const rpc = vi.fn();
  const maybeSingle = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.availability.mockReturnValue({
      available: true,
      reason: 'public_product_test',
    });
    mocks.policy.mockReturnValue({
      enabled: true,
      audience: 'public_product_test',
      merchantId,
      productId,
      expiresAt: null,
      maxAttempts: null,
    });
    rpc.mockResolvedValue({ data: [row], error: null });
    maybeSingle.mockResolvedValue({ data: shape, error: null });
    mocks.createClient.mockResolvedValue({
      rpc,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    });
  });

  it('offers the bound product to a guest using the safe public DB projection', async () => {
    const response = await GET(request());
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      available: true,
      reason: 'public_product_test',
    });
    expect(rpc).toHaveBeenCalledWith(
      'get_storefront_redvault_live_pilot_policy'
    );
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it.each(
    [
      null,
      [],
      [{ ...row, audience: 'private_user' }],
      [{ ...row, enabled: false }],
      [{ ...row, product_id: 'other-product' }],
      [{ ...row, merchant_id: 'other-merchant' }],
      [{ ...row, expires_at: '2030-01-01T00:00:00Z' }],
    ].map((data) => [data])
  )('hides env-public availability for DB policy %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await (await GET(request())).json()).toEqual({
      available: false,
      reason: 'unavailable',
    });
  });

  it.each([
    null,
    '22222222-2222-4222-8222-222222222222',
  ])('hides public availability for product query %j', async (product) => {
    expect(await (await GET(request(product))).json()).toEqual({
      available: false,
      reason: 'unavailable',
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    { price: 101 },
    { has_variants: true },
    { inventory_tracking_policy: 'serialized_strict' },
    { status: 'draft' },
    { brand: 'Infinix', name: 'Hot 40' },
  ])('hides catalog drift %j even when env and DB agree', async (override) => {
    maybeSingle.mockResolvedValue({
      data: { ...shape, ...override },
      error: null,
    });
    expect(await (await GET(request())).json()).toEqual({
      available: false,
      reason: 'unavailable',
    });
  });

  it('fails closed for policy RPC failures', async () => {
    rpc.mockResolvedValue({ data: [row], error: { message: 'unavailable' } });
    expect(await (await GET(request())).json()).toEqual({
      available: false,
      reason: 'unavailable',
    });
  });

  it('fails closed when the normal server client cannot be created', async () => {
    mocks.createClient.mockRejectedValue(new Error('unavailable'));
    expect(await (await GET(request())).json()).toEqual({
      available: false,
      reason: 'unavailable',
    });
  });
});
