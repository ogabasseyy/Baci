import { describe, expect, it, jest } from '@jest/globals';
import { resolveRewardedAdModule } from './rewarded-ad-module';

jest.mock('react-native-google-mobile-ads', () => ({
  RewardedAd: 'RewardedAd',
}));

describe('resolveRewardedAdModule', () => {
  it('returns the native module when present', () => {
    expect(resolveRewardedAdModule()).toMatchObject({
      RewardedAd: 'RewardedAd',
    });
  });
});
