import { describe, expect, it } from 'vitest';
import { isDurableSeoPrice } from './classify-durable-product-seo-price';
import { getProductSeoMoneyCandidates } from './get-product-seo-money-candidates';

describe('isDurableSeoPrice', () => {
  it.each([
    'The voltage is 12.5 volts.',
    'The brightness is 1,200 lumens.',
    'The bottle holds 1.5 liters.',
    'The temperature is 23.5 degrees.',
    'The weight was 900, now 800 grams',
    '1,920 x 1,080 display with HDR',
    'The resolution is 3,840 × 2,160.',
    'Displays at 2,560 x 1,440',
  ])('does not classify physical measurements as prices: %s', (text) => {
    const candidates = getProductSeoMoneyCandidates(text);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(isDurableSeoPrice(candidate, text)).toBe(false);
    }
  });

  it.each([
    'Maximum load capacity is 900 pounds.',
    'Payload capacity is 1,200 pounds.',
  ])('preserves pound-denominated capacity: %s', (text) => {
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected a monetary-looking candidate');
    expect(isDurableSeoPrice(candidate, text)).toBe(false);
  });

  it('preserves COP efficiency specifications', () => {
    const text = 'COP 4.5 efficiency';
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected candidate');
    expect(isDurableSeoPrice(candidate, text)).toBe(false);
  });

  it('preserves PHP runtime versions as technical specifications', () => {
    const text = 'Compatible with PHP 8.3 and MySQL 8';
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected a monetary-looking candidate');
    expect(isDurableSeoPrice(candidate, text)).toBe(false);
  });

  it('preserves numeric values governed by a plain model predicate', () => {
    const text = 'The model is 12345';
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected a monetary-looking candidate');
    expect(isDurableSeoPrice(candidate, text)).toBe(false);
  });

  it.each([
    'Sale: COP 4500 cooling fan',
    'Price: COP 900 heating system',
    'For COP 4500 cooling fan',
    'COP 250000 cooling fan',
    'Price range: 900–1,200',
  ])('retains explicit retail meaning for Colombian-peso prices: %s', (text) => {
    const candidate = getProductSeoMoneyCandidates(text)[0];
    if (!candidate) throw new Error('Expected candidate');
    expect(isDurableSeoPrice(candidate, text)).toBe(true);
  });

  it('classifies a short unlabelled price range after product-name removal', () => {
    for (const text of [
      '– 999–1299',
      '– 999–1299.',
      '– 1,200–1,500',
      '– ٩٠٠–١٢٠٠',
    ]) {
      const candidates = getProductSeoMoneyCandidates(text);
      expect(candidates).toHaveLength(2);
      for (const candidate of candidates) {
        expect(isDurableSeoPrice(candidate, text)).toBe(true);
      }
    }
  });

  it('preserves localized product-year ranges instead of treating them as prices', () => {
    for (const text of ['٢٠٢٠–٢٠٢٤', '۲۰۲۰–۲۰۲۴']) {
      const candidates = getProductSeoMoneyCandidates(text);
      expect(candidates).toHaveLength(2);
      for (const candidate of candidates) {
        expect(isDurableSeoPrice(candidate, text)).toBe(false);
      }
    }
  });

  it('does not classify common display-resolution pairs as prices', () => {
    for (const text of ['3840–2160', '1024–768', '1080–1920', '– 1366–768']) {
      const candidates = getProductSeoMoneyCandidates(text);
      expect(candidates).toHaveLength(2);
      for (const candidate of candidates) {
        expect(isDurableSeoPrice(candidate, text)).toBe(false);
      }
    }
  });

  it('keeps short ascending unlabelled ranges classified as prices', () => {
    const text = '999–1299';
    const candidates = getProductSeoMoneyCandidates(text);
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(isDurableSeoPrice(candidate, text)).toBe(true);
    }
  });

  it('keeps an explicit price from being mistaken for a unitless dimension pair', () => {
    for (const text of [
      'Price: 1,200 x 2',
      'Price: 1,200 x 500',
      'Price: 1,200 x 3.20',
    ]) {
      const candidate = getProductSeoMoneyCandidates(text)[0];
      if (!candidate) throw new Error('Expected candidate');
      expect(isDurableSeoPrice(candidate, text)).toBe(true);
    }
  });

  it.each([
    'The SKU was 999, now 799',
    'SKU: was 999, now 799',
    'SKU:was 999, now 799',
  ])('does not interpret paired SKU updates as sale prices: %s', (text) => {
    const candidates = getProductSeoMoneyCandidates(text);
    // Tokenization already excludes the first value governed by the SKU label.
    expect(candidates.map(({ start, end }) => text.slice(start, end))).toEqual([
      '799',
    ]);
    for (const candidate of candidates) {
      expect(isDurableSeoPrice(candidate, text)).toBe(false);
    }
  });

  it('still classifies an explicit pound-denominated sale as a price', () => {
    const text = 'Weighs 5 pounds and sells for 900 pounds.';
    const candidate = getProductSeoMoneyCandidates(text).at(-1);
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected a monetary-looking candidate');
    expect(isDurableSeoPrice(candidate, text)).toBe(true);
  });
});
