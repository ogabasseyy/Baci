import { describe, expect, it, jest } from '@jest/globals';
import { resolveRewardedAdModule } from './rewarded-ad-module';

jest.mock('react-native-google-mobile-ads', () => {
  throw new Error('no native module');
});

describe('resolveRewardedAdModule without a native module', () => {
  it('returns null instead of throwing', () => {
    expect(resolveRewardedAdModule()).toBeNull();
  });
});
