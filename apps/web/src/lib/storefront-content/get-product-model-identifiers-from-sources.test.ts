import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiersFromSources } from './get-product-model-identifiers-from-sources';

describe('getProductModelIdentifiersFromSources', () => {
  it('falls back to a paired slug when the product name has no model', () => {
    const identifiers = getProductModelIdentifiersFromSources(
      ['Samsung Smartphone'],
      ['samsung-galaxy-s25'],
      (source) => (source.includes('s25') ? 's25' : undefined)
    );

    expect(identifiers).toEqual(['s25']);
  });

  it('prefers a paired slug identifier that extends the display-name model', () => {
    const identifiers = getProductModelIdentifiersFromSources(
      ['Apple iPhone 15'],
      ['apple-iphone-15-pro'],
      (source) => (source.includes('pro') ? '15 pro' : '15')
    );

    expect(identifiers).toEqual(['15 pro']);
  });

  it('prefers a paired slug that adds a model-family prefix', () => {
    const identifiers = getProductModelIdentifiersFromSources(
      ['HP 15'],
      ['hp-pavilion-15'],
      (source) => (source.includes('pavilion') ? 'pavilion 15' : '15')
    );

    expect(identifiers).toEqual(['pavilion 15']);
  });

  it('prefers a paired slug that adds a numeric model to a text family', () => {
    const identifiers = getProductModelIdentifiersFromSources(
      ['Dell XPS'],
      ['dell-xps-13'],
      (source) =>
        source
          .replaceAll('-', ' ')
          .replace(/^dell\s+/iu, '')
          .toLowerCase()
    );

    expect(identifiers).toEqual(['xps 13']);
  });

  it('does not replace a clean name identifier with SEO slug words', () => {
    const identifiers = getProductModelIdentifiersFromSources(
      ['Apple iPhone 15'],
      ['buy-iphone-15-online'],
      (source) => (source.includes('buy') ? 'buy 15 online' : '15')
    );

    expect(identifiers).toEqual(['15']);
  });
});
