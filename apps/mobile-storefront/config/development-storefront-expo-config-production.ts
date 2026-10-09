import type { ConfigContext, ExpoConfig } from 'expo/config';

// Preserve typed imports at the original path; Expo loads the plain CJS file.
export const buildStorefrontConfig: (context: ConfigContext) => ExpoConfig =
  require('./development-storefront-expo-config-production.js').buildStorefrontConfig;
