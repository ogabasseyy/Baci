import { describe, expect, it } from 'vitest';
import { builderAiFeatureIconNames } from './feature-icons';

describe('builderAiFeatureIconNames', () => {
  it('includes the Puck Features default icon', () => {
    expect(builderAiFeatureIconNames).toContain('headphones');
  });
});
