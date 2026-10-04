import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfiguredAgenticMerchantSlug } from './agentic-merchant-slug';

describe('getConfiguredAgenticMerchantSlug', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('BACI_AGENTIC_MERCHANT_SLUG', '');
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', '');
  });

  it('reads the BACI tenant slug', () => {
    vi.stubEnv('BACI_AGENTIC_MERCHANT_SLUG', 'winter-store');

    expect(getConfiguredAgenticMerchantSlug()).toBe('winter-store');
  });

  it('supports the legacy OPENAI tenant slug alias', () => {
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'legacy-store');

    expect(getConfiguredAgenticMerchantSlug()).toBe('legacy-store');
  });

  it('prefers the BACI slug over the legacy alias', () => {
    vi.stubEnv('BACI_AGENTIC_MERCHANT_SLUG', 'winter-store');
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'legacy-store');

    expect(getConfiguredAgenticMerchantSlug()).toBe('winter-store');
  });

  it('trims surrounding whitespace', () => {
    vi.stubEnv('BACI_AGENTIC_MERCHANT_SLUG', '  winter-store  ');

    expect(getConfiguredAgenticMerchantSlug()).toBe('winter-store');
  });

  it('fails closed when no slug is configured', () => {
    expect(getConfiguredAgenticMerchantSlug()).toBeUndefined();
  });
});
