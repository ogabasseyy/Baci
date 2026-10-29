import { describe, expect, it } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories' },
];

describe('customer product replacement constraints', () => {
  it.each([
    'Samsung phones under 300k without a charger',
    'Samsung phones without WiFi only and without a charger under 300k',
    'iPhone chargers under 10k without a case',
    'Not iPhone, Samsung phones under 300k',
    'Samsung or iPhone phones under 300k',
    'Samsung instead of iPhone phones under 300k',
    'phone or charger under 300k',
  ])('clarifies an unsupported exclusion or alternative: %s', (message) => {
    expect(
      interpretFastCatalogIntent([message], categories, 'NGN')
    ).toMatchObject({
      kind: 'clarify',
      reason: 'options',
    });
  });

  it('does not clear a pending switch with an unsupported exclusion', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show me iPhones under 500k',
          'Samsung instead',
          'Samsung phones under 300k without a charger',
          'Samsung phones',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it.each([
    'Samsung phones with charger under 300k',
    'Samsung phone and case under 300k',
    'Samsung phones with earbuds under 300k',
    'Samsung phones + charger under 300k',
    'Samsung phones+charger under 300k',
    'Samsung phone +charger under 300k',
    'Samsung phone & charger under 300k',
    'Samsung phone, charger under 300k',
    'charger+phone under 300k',
    'case+tablet under 300k',
    'earbuds+laptop under 300k',
    'MacBook with charger under 300k',
    'MacBook+charger under 300k',
    'Laptop and earbuds under 300k',
    'Tablet with case under 300k',
  ])('does not treat an unverified bundle as a complete replacement: %s', (text) => {
    expect(interpretFastCatalogIntent([text], categories, 'NGN')).toMatchObject(
      {
        kind: 'clarify',
        reason: 'options',
      }
    );
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhones under 500k', 'Samsung instead', text],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it('continues to support an explicit Wi-Fi-only exclusion', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me Samsung phones under 300k without WiFi only'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', wifiOnly: false });
  });

  it('continues to recognize an ordinary device accessory request', () => {
    expect(
      interpretFastCatalogIntent(
        ['iPhone chargers under 10k'],
        categories,
        'NGN'
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'accessories',
      maxPrice: 10_000,
    });
  });
});
