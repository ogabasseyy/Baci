import { describe, expect, it, vi } from 'vitest';
import { resolveBodyOnlyMerchantSender } from './resolve-body-only-merchant-sender';

const mockResolveQuoteMerchantLookupClient = vi.hoisted(() => vi.fn());
const mockResolvePublicMerchantSender = vi.hoisted(() => vi.fn());

vi.mock('./resolve-quote-merchant-lookup-client', () => ({
  resolveQuoteMerchantLookupClient: mockResolveQuoteMerchantLookupClient,
}));

vi.mock('./resolve-public-merchant-sender', () => ({
  resolvePublicMerchantSender: mockResolvePublicMerchantSender,
}));

describe('resolveBodyOnlyMerchantSender', () => {
  it('uses the request lookup client and forwards the merchant projection', async () => {
    const lookupClient = { kind: 'anonymous-storefront' };
    const supabase = { kind: 'admin' };
    const request = { headers: { get: vi.fn() } };
    const result = { ok: true, sender: null };
    mockResolveQuoteMerchantLookupClient.mockResolvedValue(lookupClient);
    mockResolvePublicMerchantSender.mockResolvedValue(result);

    await expect(
      resolveBodyOnlyMerchantSender(request, supabase as never, 'merchant-1')
    ).resolves.toBe(result);
    expect(mockResolveQuoteMerchantLookupClient).toHaveBeenCalledWith(
      request,
      supabase
    );
    expect(mockResolvePublicMerchantSender).toHaveBeenCalledWith(
      lookupClient,
      'merchant-1'
    );
  });

  it('preserves projection failures for the route to handle', async () => {
    const failure = { ok: false, error: { message: 'RPC unavailable' } };
    mockResolveQuoteMerchantLookupClient.mockResolvedValue({});
    mockResolvePublicMerchantSender.mockResolvedValue(failure);

    await expect(
      resolveBodyOnlyMerchantSender(
        { headers: { get: vi.fn() } },
        {} as never,
        'merchant-1'
      )
    ).resolves.toBe(failure);
  });
});
