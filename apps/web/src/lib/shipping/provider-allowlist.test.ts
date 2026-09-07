import { describe, expect, it } from 'vitest';
import {
  getNoProviderWarning,
  selectQuoteProviders,
} from './provider-allowlist';
import type { ShippingProvider } from './providers/base';

const giglProvider = { code: 'GIGL' } as ShippingProvider;
const topshipProvider = { code: 'TOPSHIP' } as ShippingProvider;

describe('provider allowlist selection', () => {
  it('keeps all registered providers when no allowlist is supplied', () => {
    expect(selectQuoteProviders([giglProvider, topshipProvider])).toEqual({
      providers: [giglProvider, topshipProvider],
      isRestricted: false,
    });
    expect(getNoProviderWarning(false)).toBe(
      'No shipping providers are currently enabled'
    );
  });

  it('filters registered providers to the explicit merchant allowlist', () => {
    expect(
      selectQuoteProviders([giglProvider, topshipProvider], ['GIGL'])
    ).toEqual({
      providers: [giglProvider],
      isRestricted: true,
    });
  });

  it('returns no providers for an explicit empty allowlist', () => {
    expect(selectQuoteProviders([giglProvider], [])).toEqual({
      providers: [],
      isRestricted: true,
    });
    expect(getNoProviderWarning(true)).toBe(
      'No carrier shipping providers are enabled for this store'
    );
  });
});
