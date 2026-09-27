import type * as GoogleMobileAds from 'react-native-google-mobile-ads';

/**
 * Lazily resolves the Google Mobile Ads native module. Builds without it
 * (e.g. Expo Go) throw on require; callers treat null as a load failure so
 * the hosting carousel drops the sponsored slide instead of rotating onto
 * a blank page.
 */
export function resolveBannerAdModule(): typeof GoogleMobileAds | null {
  try {
    return require('react-native-google-mobile-ads') as typeof GoogleMobileAds;
  } catch {
    return null;
  }
}
