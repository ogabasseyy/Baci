interface RewardedAdInstance {
  addAdEventListener: (
    event: string,
    listener: (payload?: unknown) => void
  ) => () => void;
  load: () => void;
  show: () => Promise<void>;
}

interface RewardedAdsModule {
  AdEventType: { CLOSED: string; ERROR: string };
  RewardedAd: {
    createForAdRequest: (unitId: string) => RewardedAdInstance;
  };
  RewardedAdEventType: { EARNED_REWARD: string; LOADED: string };
}

/**
 * Lazily resolves the Google Mobile Ads native module for rewarded ads.
 * Builds without it (e.g. Expo Go) throw on require; callers treat null
 * as a watch failure so the tap surfaces retry UI instead of dying
 * silently. The narrow interface matches the mocked surface the rewarded
 * hook consumes.
 */
export function resolveRewardedAdModule(): RewardedAdsModule | null {
  try {
    return require('react-native-google-mobile-ads') as RewardedAdsModule;
  } catch {
    return null;
  }
}
