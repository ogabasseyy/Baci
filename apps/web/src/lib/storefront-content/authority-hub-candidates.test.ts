import { describe, expect, it } from 'vitest';
import { buildAuthorityHubCandidates } from './authority-hub-candidates';

describe('buildAuthorityHubCandidates', () => {
  it('selects the canonical brand entry for alias brand names', () => {
    const result = buildAuthorityHubCandidates(
      'smartphones',
      ['iPhone'],
      'https://store.test'
    );
    expect(result.brandHubs.map((hub) => hub.href)).toContain(
      'https://store.test/smartphones/brands/apple'
    );
  });

  it('returns no candidates for unmatched brands or unsupported categories', () => {
    expect(
      buildAuthorityHubCandidates('smartphones', ['NoSuchBrand'], 'https://s')
    ).toEqual({ brandHubs: [], familyHubs: [] });
    expect(
      buildAuthorityHubCandidates('unknown-category', ['Apple'], 'https://s')
    ).toEqual({ brandHubs: [], familyHubs: [] });
  });

  it('expands family hubs under matched brands', () => {
    const result = buildAuthorityHubCandidates(
      'smartphones',
      ['Samsung'],
      'https://store.test'
    );
    expect(result.brandHubs.map((hub) => hub.brand_key)).toContain('samsung');
    expect(result.familyHubs.length).toBeGreaterThan(0);
    expect(result.familyHubs.every((hub) => hub.brand_key === 'samsung')).toBe(
      true
    );
  });

  it('normalizes a trailing slash on the store URL', () => {
    const result = buildAuthorityHubCandidates(
      'smartphones',
      ['Apple'],
      'https://store.test/'
    );
    expect(result.brandHubs[0]?.href).toBe(
      'https://store.test/smartphones/brands/apple'
    );
  });
});
