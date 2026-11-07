import { normalizeProviderError } from './normalize-provider-error';

describe('provider error normalization', () => {
  it('maps provider failures to local stable codes without raw detail', () => {
    const bait = 'Bearer secret-token merchant@example.com request-id-123';

    expect(normalizeProviderError({ status: 401, unsafeCause: bait })).toEqual({
      code: 'provider_authentication_failed',
    });
    expect(normalizeProviderError({ status: 429, unsafeCause: bait })).toEqual({
      code: 'provider_rate_limited',
    });
    expect(normalizeProviderError({ status: 503, unsafeCause: bait })).toEqual({
      code: 'provider_unavailable',
    });
    expect(
      JSON.stringify(normalizeProviderError({ unsafeCause: bait }))
    ).not.toContain(bait);
  });
});
