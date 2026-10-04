import { describe, expect, it } from 'vitest';
import { discoveryEmbeddingSource } from './discovery-embedding-source';

describe('discoveryEmbeddingSource', () => {
  it('matches the existing SQL hash and strips markup from Gemini text', () => {
    const source = discoveryEmbeddingSource({
      name: 'Redmi 15', brand: 'Xiaomi', category: 'Smartphones', description: 'A phone',
    });
    expect(source.sourceHash).toBe('efaa6bb39d16832e5ef7a42fd212e182b9bdb183a1c25c2bc976bc266bf4ad9a');
    expect(discoveryEmbeddingSource({
      name: 'Redmi 15', brand: 'Xiaomi', category: 'Smartphones', description: '<b>A phone</b>',
    }).text).toBe('Xiaomi. Smartphones. A phone');
  });

  it('falls back to the product name when the searchable description is empty', () => {
    expect(discoveryEmbeddingSource({ name: 'Redmi 15', brand: null, category: null, description: null }).text).toBe('Redmi 15');
  });
});
