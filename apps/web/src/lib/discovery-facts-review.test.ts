import { describe, expect, it } from 'vitest';
import { proposeDiscoveryFacts } from './discovery-facts-review';

describe('discovery facts review proposals', () => {
  it('uses exact categories and explicit model fields, preserving verified facts', () => {
    const result = proposeDiscoveryFacts({
      category: 'Laptops',
      metadata: {
        model: 'HP 14-ep0176nia',
        storage: '512GB',
        description: 'fits Samsung',
      },
      discovery_metadata: {
        attributes: { ram_gb: 8 },
        compatible_with: ['known'],
      },
    });
    expect(result.draft).toEqual({
      product_type: 'laptop',
      model: 'HP 14-ep0176nia',
      attributes: { ram_gb: 8 },
      compatible_with: ['known'],
    });
  });
  it('does not guess accessory type/model from marketing or broad category', () => {
    expect(
      proposeDiscoveryFacts({
        category: 'Accessories',
        metadata: {
          name: 'Apple Charger 20W',
          description: 'For iPhone',
          model_numbers: 'A123',
        },
        discovery_metadata: null,
      }).draft
    ).toEqual({});
    expect(
      proposeDiscoveryFacts({
        category: 'constructor',
        metadata: {},
        discovery_metadata: null,
      }).draft
    ).toEqual({});
  });
  it('holds conflicting models for review and never overwrites existing identity', () => {
    const input = {
      category: null,
      metadata: { model: 'A', canonical_model: 'B' },
      discovery_metadata: null,
    };
    const result = proposeDiscoveryFacts(input);
    expect(result.draft).not.toHaveProperty('model');
    expect(result.warnings).toContain(
      'Stored model identities disagree; confirm the correct identity.'
    );
    expect(
      proposeDiscoveryFacts({
        ...input,
        discovery_metadata: { model: 'verified' },
      }).draft.model
    ).toBe('verified');
  });
  it('marks invalid existing facts for explicit repair', () => {
    const result = proposeDiscoveryFacts({
      category: null,
      metadata: {},
      discovery_metadata: { attributes: { ram_gb: '8' } },
    });
    expect(result.existingValid).toBe(false);
    expect(result.draft).toEqual({ attributes: { ram_gb: '8' } });
  });
});

it('keeps an invalid raw snapshot unchanged when adding proposed identity', () => {
  const snapshot = { attributes: { ram_gb: '8' } };
  const result = proposeDiscoveryFacts({
    category: 'Laptops',
    metadata: { model: 'Known' },
    discovery_metadata: snapshot,
  });
  expect(snapshot).toEqual({ attributes: { ram_gb: '8' } });
  expect(result.draft).toMatchObject({
    product_type: 'laptop',
    model: 'Known',
  });
  expect(result.draft).not.toBe(snapshot);
});
