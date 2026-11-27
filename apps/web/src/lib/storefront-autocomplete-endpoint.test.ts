import { describe, expect, it } from 'vitest';
import {
  getAutocompleteEndpoint,
  getAutocompleteOrigin,
  normalizeAutocompleteOrigin,
} from './storefront-autocomplete-endpoint';

describe('storefront-autocomplete-endpoint', () => {
  it('normalizes valid HTTPS and localhost origins and rejects unsafe URLs', () => {
    expect(
      normalizeAutocompleteOrigin(
        ' https://baci-autocomplete-proxy.ogabassey-ai.workers.dev/search?x=1 '
      )
    ).toBe('https://baci-autocomplete-proxy.ogabassey-ai.workers.dev');
    expect(normalizeAutocompleteOrigin('http://localhost:8787/test')).toBe(
      'http://localhost:8787'
    );
    expect(
      normalizeAutocompleteOrigin('http://insecure.example.com')
    ).toBeUndefined();
    expect(
      normalizeAutocompleteOrigin('https://user:pass@example.com')
    ).toBeUndefined();
    expect(normalizeAutocompleteOrigin('not a url')).toBeUndefined();
  });

  it('prefers NEXT_PUBLIC_AUTOCOMPLETE_URL and falls back to /api/search/autocomplete', () => {
    expect(
      getAutocompleteEndpoint({
        NEXT_PUBLIC_AUTOCOMPLETE_URL:
          'https://baci-autocomplete-proxy.ogabassey-ai.workers.dev',
      })
    ).toBe('https://baci-autocomplete-proxy.ogabassey-ai.workers.dev');
    expect(getAutocompleteEndpoint({})).toBe('/api/search/autocomplete');
    expect(getAutocompleteOrigin({})).toBeUndefined();
  });
});
