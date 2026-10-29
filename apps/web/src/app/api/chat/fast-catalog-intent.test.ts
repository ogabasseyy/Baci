import { describe, expect, it } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'laptops', name: 'Laptops', slug: 'laptops' },
  { id: 'gaming', name: 'Gaming Accessories', slug: 'gaming-accessories' },
  { id: 'earbuds', name: 'Earbuds', slug: 'earbuds' },
];

describe('interpretFastCatalogIntent', () => {
  it('treats gaming phones as a phone category request, not a gaming-accessory search', () => {
    expect(
      interpretFastCatalogIntent(['Best gaming phones'], categories)
    ).toMatchObject({
      categoryId: 'phones',
      kind: 'search',
      query: '',
      wifiOnly: false,
    });
  });

  it('keeps the requested model and explicit budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhone 16 Pro under ₦500k'],
        categories
      )
    ).toMatchObject({
      categoryId: 'phones',
      kind: 'search',
      maxPrice: 500_000,
      query: 'iPhone 16 Pro',
    });
  });

  it('preserves an explicit Wi-Fi-only request but not a negated one', () => {
    expect(
      interpretFastCatalogIntent(['iPhone 16 Wi-Fi only'], categories)
    ).toMatchObject({ kind: 'search', wifiOnly: true });
    expect(
      interpretFastCatalogIntent(['iPhone 16 not Wi-Fi only'], categories)
    ).toMatchObject({ kind: 'search', wifiOnly: false });
  });

  it('does not silently drop Wi-Fi-only because of an unrelated negation', () => {
    expect(
      interpretFastCatalogIntent(['Wi-Fi only iPhone, no rush'], categories)
    ).toMatchObject({ kind: 'clarify', reason: 'options' });
    expect(
      interpretFastCatalogIntent(['iPhone 16 no Wi-Fi only'], categories)
    ).toMatchObject({ kind: 'search', wifiOnly: false, query: 'iPhone 16' });
  });

  it('does not intercept a payment or order request mentioning a phone', () => {
    expect(
      interpretFastCatalogIntent(['Cancel my iPhone order'], categories)
    ).toBeNull();
    expect(
      interpretFastCatalogIntent(['I paid for a phone'], categories)
    ).toBeNull();
  });

  it('leaves price negotiations and discount questions to the existing chat flow', () => {
    for (const message of [
      'What is your last price for iPhone 16?',
      'Can you reduce the price of iPhone 16 Pro?',
      'Do you offer a discount on AirPods?',
      'Can I pay in installments for a phone?',
      'What warranty comes with this phone?',
    ]) {
      expect(interpretFastCatalogIntent([message], categories)).toBeNull();
    }
  });

  it('uses the catalog for a direct best-price question', () => {
    expect(
      interpretFastCatalogIntent(
        ['What is the best price for iPhone 16?'],
        categories
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone 16' });
  });

  it('asks for clarification instead of dropping an unparseable budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me a phone within my budget'],
        categories
      )
    ).toMatchObject({ kind: 'clarify' });
  });

  it('uses the previous shopping request when a customer follows up with a budget', () => {
    expect(
      interpretFastCatalogIntent(['Show me laptops', 'Under 500k'], categories)
    ).toMatchObject({
      categoryId: 'laptops',
      kind: 'search',
      maxPrice: 500_000,
    });
  });

  it('uses a previously named product for a price follow-up', () => {
    expect(
      interpretFastCatalogIntent(
        ['iPhone 16 Pro', 'How much is it?'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      query: 'iPhone 16 Pro',
      categoryId: 'phones',
    });
  });

  it.each([
    'What is the price?',
    "What's the cost?",
    'Price?',
  ])('uses the previous named product for a short price follow-up: %s', (followUp) => {
    expect(
      interpretFastCatalogIntent(['Show me iPhone 16', followUp], categories)
    ).toMatchObject({ kind: 'search', query: 'iPhone 16' });
  });

  it('asks which product a short price follow-up means after a broad search', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'What is the price?'],
        categories
      )
    ).toMatchObject({ kind: 'clarify', reason: 'product' });
  });

  it('keeps the accessory in a short price follow-up', () => {
    expect(
      interpretFastCatalogIntent(['Show me a charger', 'Price?'], categories)
    ).toMatchObject({ kind: 'search', query: 'charger', isAccessory: true });
  });

  it('leaves an ungrounded or purchase follow-up to the existing chat flow', () => {
    expect(
      interpretFastCatalogIntent(['How much is it?'], categories)
    ).toBeNull();
    expect(
      interpretFastCatalogIntent(['iPhone 16', 'I want to buy it'], categories)
    ).toBeNull();
  });

  it('asks which product a price follow-up means after a broad search', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'How much is it?'],
        categories
      )
    ).toMatchObject({ kind: 'clarify', reason: 'product' });
  });

  it('does not leave an earlier budget in a follow-up model search', () => {
    expect(
      interpretFastCatalogIntent(
        ['iPhone 16 under 900k', 'Under 500k'],
        categories
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone 16', maxPrice: 500_000 });
  });

  it('does not silently ignore a minimum or price range', () => {
    expect(
      interpretFastCatalogIntent(['Phones between 200k and 500k'], categories)
    ).toMatchObject({ kind: 'clarify' });
    expect(
      interpretFastCatalogIntent(['Phones over 200k'], categories)
    ).toMatchObject({ kind: 'clarify' });
  });

  it('does not silently ignore condition, storage, colour, or SIM preferences', () => {
    for (const message of [
      'Show me used phones',
      'iPhone 16 with 256GB',
      'Show me a blue phone',
      'iPhone with physical SIM',
      'a phone with 8GB RAM',
    ]) {
      expect(interpretFastCatalogIntent([message], categories)).toMatchObject({
        kind: 'clarify',
        reason: 'options',
      });
    }
  });

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
