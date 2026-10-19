import { describe, expect, it, jest } from '@jest/globals';
import { isQuizMobileAdsAvailable } from './is-quiz-mobile-ads-available';

describe('isQuizMobileAdsAvailable', () => {
  it('returns false when the installed dev client lacks the native module', () => {
    const loadNativeModule = jest.fn(() => null);

    expect(isQuizMobileAdsAvailable(loadNativeModule)).toBe(false);
    expect(loadNativeModule).toHaveBeenCalledWith('RNGoogleMobileAdsModule');
  });

  it('returns true when the native ads module is installed', () => {
    expect(isQuizMobileAdsAvailable(() => ({}))).toBe(true);
  });
});
