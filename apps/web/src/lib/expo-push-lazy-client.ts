import Expo from 'expo-server-sdk';

/**
 * Lazy Expo client factory (avoids a module-level constructor for
 * testability). The access-token accessor is injected so this module never
 * imports the credential-bearing environment module itself.
 */
export function createLazyExpoGetter(
  getAccessToken: () => string | undefined
): () => Expo {
  let expo: Expo | null = null;
  return () => {
    if (!expo) {
      const accessToken = getAccessToken();
      if (!accessToken) {
        console.warn(
          '[expo-push] EXPO_ACCESS_TOKEN is not set — push notifications may fail or be rate-limited'
        );
      }
      expo = new Expo({ accessToken });
    }
    return expo;
  };
}
