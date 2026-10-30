import { describe, expect, it } from 'vitest';
import {
  catalogPreferenceText,
  hasAmbiguousProductBundle,
  hasCatalogProductCue,
  hasNegatedBudget,
  hasUnsupportedDisjunction,
  isBusinessFactRequest,
  isCatalogBoundary,
  isRelativePriceRequest,
  normalizeUseCasePhrases,
  resolveWifiOnly,
  stripRelativePricePhrases,
} from './fast-catalog-language';

describe('catalog conversation language', () => {
  it('distinguishes a store phone-number request from a phone search', () => {
    expect(isBusinessFactRequest('What is your phone number?')).toBe(true);
    expect(isBusinessFactRequest('Show me a phone under 300k')).toBe(false);
  });

  it('treats order actions as boundaries without blocking product searches', () => {
    expect(isCatalogBoundary('Cancel my order')).toBe(true);
    expect(isCatalogBoundary('Order me an iPhone')).toBe(false);
  });

  it('recognizes a negated compact budget without negating a normal limit', () => {
    expect(hasNegatedBudget('Not under300k')).toBe(true);
    expect(hasNegatedBudget('Under300k')).toBe(false);
  });

  it('recognizes unsupported substitutions without matching model-name substrings', () => {
    expect(hasUnsupportedDisjunction('Samsung or iPhone')).toBe(true);
    expect(hasUnsupportedDisjunction('Samsung instead of iPhone')).toBe(true);
    expect(hasUnsupportedDisjunction('Honor phone')).toBe(false);
  });

  it('distinguishes a complete product candidate from a budget-only reply', () => {
    expect(hasCatalogProductCue('Phones under 300k')).toBe(true);
    expect(hasCatalogProductCue('iPhone charger under 10k')).toBe(true);
    expect(hasCatalogProductCue('Under 300k')).toBe(false);
  });

  it('distinguishes a joined phone and accessory from a device-compatible accessory', () => {
    expect(hasAmbiguousProductBundle('Samsung phone with charger')).toBe(true);
    expect(hasAmbiguousProductBundle('Samsung phone and case')).toBe(true);
    expect(hasAmbiguousProductBundle('Samsung phone charger')).toBe(false);
    expect(hasAmbiguousProductBundle('MacBook with charger')).toBe(true);
    expect(hasAmbiguousProductBundle('Samsung phone + charger')).toBe(true);
    expect(hasAmbiguousProductBundle('Samsung Galaxy S21+ phone charger')).toBe(
      false
    );
    expect(hasAmbiguousProductBundle('Samsung Galaxy S21+ charger')).toBe(
      false
    );
    expect(hasAmbiguousProductBundle('MacBook charger')).toBe(false);
    expect(
      hasAmbiguousProductBundle('Samsung Galaxy Buds Plus with a case')
    ).toBe(true);
    expect(hasAmbiguousProductBundle('AirPods with a charger')).toBe(true);
    expect(
      hasAmbiguousProductBundle('Samsung Galaxy Buds Plus in a case')
    ).toBe(true);
    expect(
      hasAmbiguousProductBundle('Samsung Galaxy Buds Plus in a charging case')
    ).toBe(true);
    expect(hasAmbiguousProductBundle('Samsung Galaxy Buds Plus case')).toBe(
      false
    );
    expect(
      hasAmbiguousProductBundle('Samsung Galaxy Buds Plus charger with USB-C')
    ).toBe(false);
  });

  it('removes relative-price wording while retaining the product and budget', () => {
    const request = 'Anything cheaper under 300k for iPhone 16';
    expect(isRelativePriceRequest(request)).toBe(true);
    expect(stripRelativePricePhrases(request).trim()).toBe(
      'under 300k for iPhone 16'
    );
  });

  it('uses the latest Wi-Fi directive and preserves unrelated negation', () => {
    expect(resolveWifiOnly('Wi-Fi only, not Wi-Fi only')).toEqual({
      wifiOnly: false,
      otherNegation: false,
    });
    expect(resolveWifiOnly('Wi-Fi only, not refurbished')).toEqual({
      wifiOnly: true,
      otherNegation: true,
    });
  });

  it('normalizes supported use cases without turning a battery charger into a preference', () => {
    expect(normalizeUseCasePhrases('long battery life')).toBe('battery');
    expect(normalizeUseCasePhrases('best camera quality')).toBe('camera');
    expect(normalizeUseCasePhrases('hardcore gaming')).toBe('gaming');
    expect(normalizeUseCasePhrases('battery charger')).toBe('battery charger');
    expect(catalogPreferenceText('battery charger')).toMatch(/charger/);
    expect(catalogPreferenceText('battery charger')).not.toMatch(/battery/);
  });
});
