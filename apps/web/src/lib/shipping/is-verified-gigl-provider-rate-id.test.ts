import { describe, expect, it } from 'vitest';
import { isVerifiedGiglProviderRateId } from './is-verified-gigl-provider-rate-id';

describe('isVerifiedGiglProviderRateId', () => {
  it.each([
    'GIGL_30_0_1',
    'GIGL_30_1_2_7',
    'GIGL_30_0_1_0_0',
    'GIGL_30_0_1_0_1_4',
  ])('accepts canonical legacy/current rate %s', (value) => {
    expect(isVerifiedGiglProviderRateId(value)).toBe(true);
  });
  it.each([
    null,
    undefined,
    '',
    'GIGL_4_0',
    ' GIGL_30_0_1',
    'GIGL_30_0_1 ',
    'GIGL_30_9_1_0_0_4',
    'GIGL_30_0_4_0_0_4',
    'GIGL_30_0_1_0_9_4',
    'GIGL_0_0_1_0_0_4',
    'GIGL_30_0_1_0_0_0',
    'GIGL_9007199254740993_0_1_0_0_4',
  ])('rejects unverified selector %s without parser defaults', (value) => {
    expect(isVerifiedGiglProviderRateId(value)).toBe(false);
  });
});
