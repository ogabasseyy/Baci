import { describe, expect, it } from 'vitest';
import {
  isAudioCapabilityLabel,
  isPhoneOnlySpecLabel,
  normalizeSpecLabel,
} from './product-schema-spec-label-policy';

describe('product schema spec label policy', () => {
  it('normalizes and classifies shared legacy labels', () => {
    expect(normalizeSpecLabel('5G Support:')).toBe('5g support');
    expect(isPhoneOnlySpecLabel('5g support')).toBe(true);
    expect(isAudioCapabilityLabel('speakers')).toBe(true);
  });
});
