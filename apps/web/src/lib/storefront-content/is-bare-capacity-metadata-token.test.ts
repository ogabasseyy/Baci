import { describe, expect, it } from 'vitest';
import { isBareCapacityMetadataToken } from './is-bare-capacity-metadata-token';

describe('isBareCapacityMetadataToken', () => {
  it('recognizes unitless storage between a model code and labeled memory', () => {
    expect(isBareCapacityMetadataToken(['x10', '128', '6gb'], 1)).toBe(true);
  });

  it('does not classify a short model number as storage metadata', () => {
    expect(isBareCapacityMetadataToken(['g3', '15', '3579'], 1)).toBe(false);
  });

  it('recognizes a terminal common storage capacity after an established model', () => {
    expect(isBareCapacityMetadataToken(['s25', '256'], 1)).toBe(true);
  });

  it('recognizes terminal storage after an established numeric model family', () => {
    expect(isBareCapacityMetadataToken(['iphone', '15', '256'], 2)).toBe(true);
  });

  it('recognizes terminal 64 GB storage after a phone model', () => {
    expect(isBareCapacityMetadataToken(['iphone', '15', '64'], 2)).toBe(true);
  });
});
