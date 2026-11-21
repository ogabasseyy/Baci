import { describe, expect, it, vi } from 'vitest';
import { resolveVerifiedMerchantDomains } from './resolve-verified-merchant-domains';

function makeDomainSupabaseMock(result: {
  data: Array<{ domain: unknown }> | null;
  error: unknown;
}) {
  const notFn = vi.fn().mockResolvedValue(result);
  const eqStatus = vi.fn(() => ({ not: notFn }));
  const eqMerchant = vi.fn(() => ({ eq: eqStatus }));
  const select = vi.fn(() => ({ eq: eqMerchant }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, select, eqMerchant, eqStatus, notFn };
}

describe('resolveVerifiedMerchantDomains', () => {
  it('returns active verified domains for the merchant', async () => {
    const mock = makeDomainSupabaseMock({
      data: [{ domain: 'www.ogabassey.com' }, { domain: 'shop.ogabassey.com' }],
      error: null,
    });

    const domains = await resolveVerifiedMerchantDomains(
      mock.client as never,
      'merchant-1'
    );

    expect(mock.from).toHaveBeenCalledWith('domains');
    expect(mock.select).toHaveBeenCalledWith('domain');
    expect(mock.eqMerchant).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mock.eqStatus).toHaveBeenCalledWith('status', 'active');
    expect(mock.notFn).toHaveBeenCalledWith('verified_at', 'is', null);
    expect(domains).toEqual(['www.ogabassey.com', 'shop.ogabassey.com']);
  });

  it('fails closed when the domain lookup errors', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const mock = makeDomainSupabaseMock({
      data: null,
      error: { message: 'db down' },
    });

    const domains = await resolveVerifiedMerchantDomains(
      mock.client as never,
      'merchant-1'
    );

    expect(domains).toEqual([]);
    consoleSpy.mockRestore();
  });
});
