import { describe, expect, it } from 'vitest';
import { inferContentClusterContext } from './infer-content-cluster-context';

const article = {
  title: 'Apple iPhone battery decisions',
  excerpt: 'Practical information for Nigerian phone owners.',
  category: 'Smartphones',
  tags: ['Apple'],
  keywords: null,
};

describe('persisted merchant article intent', () => {
  it.each([
    ['buying-guide', 'buyer-guide'],
    ['comparison', 'decision-support'],
    ['repair-guide', 'troubleshooting'],
    ['news', null],
  ])('uses current %s intent without altering category or brand', (intent, kind) => {
    expect(
      inferContentClusterContext({
        ...article,
        merchant_intent: intent,
        merchant_intent_source: 'reviewed',
      })
    ).toMatchObject({ kind, categorySlug: 'smartphones', brands: ['apple'] });
  });

  it('does not turn classified news into a guide because its title says buying guide', () => {
    expect(
      inferContentClusterContext({
        ...article,
        title: 'Apple launches a new iPhone buying guide',
        merchant_intent: 'news',
        merchant_intent_source: 'verified_receipt',
      }).kind
    ).toBeNull();
  });

  it('preserves a matching best-in-Nigeria subtype for a classified buying guide', () => {
    expect(
      inferContentClusterContext({
        ...article,
        title: 'Best iPhones in Nigeria',
        merchant_intent: 'buying-guide',
        merchant_intent_source: 'merchant_declared',
      }).kind
    ).toBe('best-in-nigeria');
  });

  it('does not infer a best-in-Nigeria subtype from a location alone', () => {
    expect(
      inferContentClusterContext({
        ...article,
        title: 'Apple iPhone ownership in Nigeria',
        merchant_intent: 'buying-guide',
        merchant_intent_source: 'reviewed',
      }).kind
    ).toBe('buyer-guide');
  });

  it.each([
    [null, null],
    ['platform', 'reviewed'],
    ['news', null],
    ['news', 'untrusted'],
  ])('falls back to existing heuristics for invalid metadata %s / %s', (intent, source) => {
    expect(
      inferContentClusterContext({
        ...article,
        title: 'Apple iPhone buying guide',
        merchant_intent: intent,
        merchant_intent_source: source,
      }).kind
    ).toBe('buyer-guide');
  });
});
