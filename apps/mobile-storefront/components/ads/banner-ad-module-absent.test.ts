import { describe, expect, it, jest } from '@jest/globals';
import { resolveBannerAdModule } from './banner-ad-module';

jest.mock('react-native-google-mobile-ads', () => {
  throw new Error('no native module');
});

describe('resolveBannerAdModule without a native module', () => {
  it('returns null instead of throwing', () => {
    expect(resolveBannerAdModule()).toBeNull();
  });
});
