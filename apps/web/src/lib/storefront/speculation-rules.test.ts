import { describe, expect, it } from 'vitest';
import { buildStorefrontSpeculationRules } from './speculation-rules';

function hrefMatchesStrings(where: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.href_matches === 'string') {
      out.push(record.href_matches);
    }
    if (typeof record.selector_matches === 'string') {
      out.push(record.selector_matches);
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (value && typeof value === 'object') {
        walk(value);
      }
    }
  };
  walk(where);
  return out;
}

describe('buildStorefrontSpeculationRules', () => {
  it('prerenders two-segment PDP links at conservative eagerness', () => {
    // Arrange & Act
    const rules = buildStorefrontSpeculationRules('');

    // Assert
    expect(rules.prerender).toHaveLength(1);
    const [rule] = rules.prerender;
    expect(rule.eagerness).toBe('conservative');
    const include = (rule.where as { and: Array<{ href_matches?: string }> })
      .and[0];
    expect(include.href_matches).toBe('/:category/:product');
  });

  it('prefetches one-segment category links and two-segment PDP links at moderate eagerness', () => {
    // Arrange & Act
    const rules = buildStorefrontSpeculationRules('');

    // Assert
    expect(rules.prefetch).toHaveLength(2);
    const [categoryRule, pdpRule] = rules.prefetch;
    expect(categoryRule.eagerness).toBe('moderate');
    const categoryInclude = (
      categoryRule.where as { and: Array<{ href_matches?: string }> }
    ).and[0];
    expect(categoryInclude.href_matches).toBe('/:category');

    expect(pdpRule.eagerness).toBe('moderate');
    const pdpInclude = (
      pdpRule.where as { and: Array<{ href_matches?: string }> }
    ).and[0];
    expect(pdpInclude.href_matches).toBe('/:category/:product');
  });

  it('excludes per-user, state-changing, and non-product routes from prerender', () => {
    // Arrange & Act
    const patterns = hrefMatchesStrings(
      buildStorefrontSpeculationRules('').prerender[0].where
    );
    const reserved = patterns.find((p) => p.includes('cart|checkout'));

    // Assert
    expect(reserved).toBeDefined();
    for (const segment of [
      'cart',
      'checkout',
      'account',
      'wallet',
      'wishlist',
      'track-order',
      'blog',
      'api',
    ]) {
      expect(reserved).toContain(segment);
    }
  });

  it('excludes the compare listing sub-route and query strings from prerender', () => {
    // Arrange & Act
    const rule = buildStorefrontSpeculationRules('').prerender[0];
    const patterns = hrefMatchesStrings(rule.where);

    // Assert — compare sub-route via string pattern.
    expect(patterns).toContain('/*/compare');
    // Query strings via the URLPattern object form `{ search: '(.+)' }`. A
    // `/*\\?*` pathname string would match query-less URLs too and disable all
    // speculation, so the object form is required.
    expect(JSON.stringify(rule.where)).toContain('"search":"(.+)"');
  });

  it('adds per-link opt-out and rel=nofollow escape hatches to both rules', () => {
    // Arrange & Act
    const rules = buildStorefrontSpeculationRules('');

    // Assert
    for (const where of [rules.prerender[0].where, rules.prefetch[0].where]) {
      const selectors = hrefMatchesStrings(where);
      expect(selectors).toContain('[data-no-speculation]');
      expect(selectors).toContain('[rel~=nofollow]');
    }
  });

  it('prefixes every pattern with the routing base path', () => {
    // Arrange & Act
    const rules = buildStorefrontSpeculationRules('/ogabassey');
    const patterns = [
      ...hrefMatchesStrings(rules.prerender[0].where),
      ...hrefMatchesStrings(rules.prefetch[0].where),
    ].filter(
      (p) => p.startsWith('/o') || p.startsWith('/:') || p.startsWith('/*')
    );

    // Assert — href_matches carry the base path; selector patterns do not.
    expect(
      hrefMatchesStrings(rules.prerender[0].where).find((p) =>
        p.includes(':category/:product')
      )
    ).toBe('/ogabassey/:category/:product');
    expect(
      hrefMatchesStrings(rules.prefetch[0].where).find(
        (p) => p === '/ogabassey/:category'
      )
    ).toBe('/ogabassey/:category');
    expect(patterns.length).toBeGreaterThan(0);
  });
});
