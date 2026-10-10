import type { ConfigContext, ExpoConfig } from 'expo/config';

// Type-only shim: Expo loads development-storefront-expo-config-production.js
// (the sole runtime source of truth) while type stripping is disabled, so
// behavior edits belong in the .js file — changes here alone have no effect.
export const buildStorefrontConfig: (context: ConfigContext) => ExpoConfig =
  require('./development-storefront-expo-config-production.js').buildStorefrontConfig;
