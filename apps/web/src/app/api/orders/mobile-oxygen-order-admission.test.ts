import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readOxygenMobileCapabilities } from '@/lib/payments/oxygen/mobile-capabilities';
import { rejectUnavailableMobileOxygenOrder } from './mobile-oxygen-order-admission';

vi.mock('@/lib/payments/oxygen/mobile-capabilities', () => ({
  readOxygenMobileCapabilities: vi.fn(),
}));

const merchant = { id: 'merchant-id', slug: 'shop' };
const args = {
  client: { rpc: vi.fn() },
  merchant,
  paymentMethod: 'oxygen',
  request: new Request('https://shop.example.com/api/orders'),
  source: 'mobile_app',
  userId: 'buyer',
};
const enabled = {
  ok: true,
  capabilities: {
    schemaVersion: 1,
    environment: 'staging',
    authOrigin: 'https://auth.example.com',
    merchant,
    mobileEnabled: true,
    reason: null,
    hostedOrigins: ['https://hosted.example.com'],
    selfieOrigins: ['https://selfie.example.com'],
  },
} as const;
const declarations = vi.mocked(readOxygenMobileCapabilities);
beforeEach(() => {
  declarations.mockReset();
  declarations.mockResolvedValue({
    ...enabled,
    capabilities: {
      ...enabled.capabilities,
      hostedOrigins: [...enabled.capabilities.hostedOrigins],
      selfieOrigins: [...enabled.capabilities.selfieOrigins],
    },
  });
});

describe('mobile Oxygen order admission', () => {
  it('admits a signed-in staging customer for the current merchant', async () => {
    await expect(rejectUnavailableMobileOxygenOrder(args)).resolves.toBeNull();
    expect(declarations).toHaveBeenCalledWith(args.client, merchant.slug);
  });

  it('rejects non-NGN orders before checking capabilities', async () => {
    const result = await rejectUnavailableMobileOxygenOrder({
      ...args,
      merchant: { ...merchant, payout_currency: 'USD' },
    });
    expect(result?.status).toBe(409);
    expect(declarations).not.toHaveBeenCalled();
  });

  it('blocks unsigned mobile requests before checking capabilities', async () => {
    const result = await rejectUnavailableMobileOxygenOrder({
      ...args,
      userId: null,
    });
    expect(result?.status).toBe(401);
    expect(declarations).not.toHaveBeenCalled();
  });

  it.each([
    404, 503,
  ] as const)('fails closed when the capability check returns %s', async (status) => {
    declarations.mockResolvedValue({ ok: false, status });
    expect((await rejectUnavailableMobileOxygenOrder(args))?.status).toBe(
      status === 503 ? 503 : 409
    );
  });

  it('rejects a Bearer order when mobile capability is disabled even with a web source', async () => {
    declarations.mockResolvedValue({
      ...enabled,
      capabilities: {
        ...enabled.capabilities,
        mobileEnabled: false,
        reason: 'Disabled',
        hostedOrigins: [],
        selfieOrigins: [],
      },
    });
    const request = new Request(args.request, {
      headers: { authorization: 'Bearer test' },
    });
    const result = await rejectUnavailableMobileOxygenOrder({
      ...args,
      request,
      source: 'online_store',
    });
    expect(result?.status).toBe(409);
  });

  it('rechecks admission when checkout reuses an existing idempotency key', async () => {
    declarations.mockResolvedValue({ ok: false, status: 404 });
    const result = await rejectUnavailableMobileOxygenOrder({
      ...args,
      request: new Request(args.request, {
        headers: { 'Idempotency-Key': '43276b67-0362-4d83-a522-eb445dc11735' },
      }),
    });
    expect(result?.status).toBe(409);
    expect(declarations).toHaveBeenCalledWith(args.client, merchant.slug);
  });

  it.each([
    { paymentMethod: 'card' },
    { source: 'online_store' },
  ])('leaves unrelated payment methods and web checkout admission intact', async (overrides) => {
    await expect(
      rejectUnavailableMobileOxygenOrder({ ...args, ...overrides })
    ).resolves.toBeNull();
    expect(declarations).not.toHaveBeenCalled();
  });
});
