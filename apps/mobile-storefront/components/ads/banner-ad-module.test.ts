import { describe, expect, it, jest } from '@jest/globals';
import { resolveBannerAdModule } from './banner-ad-module';

jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
}));

describe('resolveBannerAdModule', () => {
  it('returns the native module when present', () => {
    expect(resolveBannerAdModule()).toMatchObject({ BannerAd: 'BannerAd' });
  });
});
