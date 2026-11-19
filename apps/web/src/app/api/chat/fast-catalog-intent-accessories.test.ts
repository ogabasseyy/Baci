import { describe, expect, it } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'laptops', name: 'Laptops', slug: 'laptops' },
  { id: 'gaming', name: 'Gaming Accessories', slug: 'gaming-accessories' },
  { id: 'earbuds', name: 'Earbuds', slug: 'earbuds' },
];

describe('interpretFastCatalogIntent', () => {
  it('recognizes a Galaxy model even when phone is not mentioned', () => {
    expect(
      interpretFastCatalogIntent(
        ['Which Samsung Galaxy S26 is available?'],
        categories
      )
    ).toMatchObject({
      categoryId: 'phones',
      kind: 'search',
      query: 'Samsung Galaxy S26',
    });
  });

  it('removes conversational words from a use-case search', () => {
    expect(
      interpretFastCatalogIntent(['I need a phone for camera'], categories)
    ).toMatchObject({ kind: 'search', query: '', preference: 'camera' });
  });

  it('does not ignore a second requested use case', () => {
    expect(
      interpretFastCatalogIntent(['Phones for gaming and camera'], categories)
    ).toMatchObject({ kind: 'clarify', reason: 'options' });
  });

  it('does not recommend a use case the customer excluded', () => {
    expect(
      interpretFastCatalogIntent(['I want phones not for gaming'], categories)
    ).toMatchObject({ kind: 'clarify', reason: 'options' });
  });

  it('does not silently choose one of multiple requested categories', () => {
    expect(
      interpretFastCatalogIntent(['Recommend phones or laptops'], categories)
    ).toMatchObject({ kind: 'clarify' });
  });

  it('does not claim to filter Wi-Fi-only variants in a non-phone category', () => {
    expect(
      interpretFastCatalogIntent(['Wi-Fi only laptop'], categories)
    ).toMatchObject({ kind: 'clarify', reason: 'options' });
  });

  it('searches a named accessory even when it has no supported category alias', () => {
    expect(
      interpretFastCatalogIntent(["I'm looking for a charger"], categories)
    ).toMatchObject({ kind: 'search', query: 'charger' });
    expect(
      interpretFastCatalogIntent(['What is the price of AirPods?'], categories)
    ).toMatchObject({ kind: 'search', query: 'AirPods' });
    expect(
      interpretFastCatalogIntent(['I am looking for a charger'], categories)
    ).toMatchObject({ kind: 'search', query: 'charger', isAccessory: true });
  });

  it('recognizes accessories by name and does not treat a phone charger as a phone', () => {
    expect(
      interpretFastCatalogIntent(['AirPods Pro'], categories)
    ).toMatchObject({
      kind: 'search',
      query: 'AirPods Pro',
      isPhoneCategory: false,
    });
    const charger = interpretFastCatalogIntent(
      ['Show me a phone charger'],
      categories
    );
    expect(charger).toMatchObject({
      kind: 'search',
      query: 'charger',
      isPhoneCategory: false,
    });
    expect(charger).not.toHaveProperty('categoryId');
    expect(
      interpretFastCatalogIntent(['phone chargers'], categories)
    ).toMatchObject({ kind: 'search', query: 'charger', isAccessory: true });
    expect(
      interpretFastCatalogIntent(['phone cases'], categories)
    ).toMatchObject({
      kind: 'search',
      query: 'case',
      isAccessory: true,
      phoneProtectiveAccessory: true,
    });
  });

  it('treats wireless as an evidence-backed requirement for earbuds', () => {
    expect(
      interpretFastCatalogIntent(['Recommend wireless earbuds'], categories)
    ).toMatchObject({
      kind: 'search',
      categoryId: 'earbuds',
      query: '',
      wirelessEarbudsOnly: true,
    });
    expect(
      interpretFastCatalogIntent(['Samsung wireless earbuds'], categories)
    ).toMatchObject({
      kind: 'search',
      categoryId: 'earbuds',
      query: 'Samsung',
      wirelessEarbudsOnly: true,
    });
    expect(
      interpretFastCatalogIntent(['earbuds without wireless'], categories)
    ).toMatchObject({
      kind: 'clarify',
      reason: 'options',
    });
  });

  it.each([
    'non-wireless earbuds',
    'not wireless earbuds',
    'non bluetooth earbuds',
    "I don't want wireless earbuds",
    "earbuds that aren't wireless",
    'wired earbuds instead of wireless',
    'I don’t want wireless earbuds',
  ])('does not reverse an excluded wireless requirement: %s', (message) => {
    expect(interpretFastCatalogIntent([message], categories)).toMatchObject({
      kind: 'clarify',
      reason: 'options',
    });
  });

  it('routes a selling question for an unfamiliar product through catalog search', () => {
    expect(
      interpretFastCatalogIntent(['Do you sell Xbox?'], categories)
    ).toMatchObject({ kind: 'search', query: 'Xbox' });
  });

  it('recognizes an intent to order a phone as a catalog search', () => {
    expect(
      interpretFastCatalogIntent(['I want to order an iPhone 16'], categories)
    ).toMatchObject({ kind: 'search', query: 'iPhone 16' });
    expect(
      interpretFastCatalogIntent(
        ['I want to order an iPhone 16 and cancel my order'],
        categories
      )
    ).toBeNull();
  });

  it('normalizes a plural iPhone shopping request while preserving its budget', () => {
    expect(
      interpretFastCatalogIntent(['Show me iPhones under 500000'], categories)
    ).toMatchObject({ kind: 'search', query: 'iPhone', maxPrice: 500000 });
  });

  it('uses the earbuds category for a generic earbuds request', () => {
    expect(
      interpretFastCatalogIntent(['best earbuds'], categories)
    ).toMatchObject({
      kind: 'search',
      categoryId: 'earbuds',
      query: '',
      isAccessory: true,
    });
  });

  it('keeps phone screen protectors tied to a phone model', () => {
    expect(
      interpretFastCatalogIntent(['phone screen protectors'], categories)
    ).toMatchObject({
      kind: 'search',
      query: 'screen protector',
      phoneProtectiveAccessory: true,
    });
  });

  it('treats under and less than as exclusive price limits', () => {
    expect(
      interpretFastCatalogIntent(['Phones under 500k'], categories)
    ).toMatchObject({
      kind: 'search',
      maxPrice: 500_000,
      exclusiveMaxPrice: true,
    });
    expect(
      interpretFastCatalogIntent(['Phones up to 500k'], categories)
    ).toMatchObject({
      kind: 'search',
      maxPrice: 500_000,
      exclusiveMaxPrice: false,
    });
  });
});
