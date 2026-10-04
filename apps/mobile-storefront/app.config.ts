import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { buildDevelopmentStorefrontExpoConfig as buildDevelopmentConfig } from './config/development-storefront-expo-config';

// Local .env values (Supabase URL/key, API origin, merchant id) must be
// visible to the first branch decision below: dotenv fills gaps without
// overriding real environment variables.
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config({
    path: path.resolve(__dirname, '.env'),
    quiet: true,
  });
}

// Fail-closed by design: when EXPO_PUBLIC_HOSTED_STOREFRONT=1 is combined
// with NODE_ENV!=development, EAS_BUILD, or CI, the builder THROWS
// ('Hosted storefront requires an isolated development launch') instead of
// returning the production config. A stray hosted flag must hard-fail config
// loading rather than silently build production as staging (or vice versa);
// no EAS profile sets the flag. Pinned by
// config/development-storefront-expo-config.test.mjs ('rejects release, CI,
// malformed mode and competing test modes').
// Routing contract: the development builder returns null when no dev-mode
// flag is set (the normal production/EAS/CI case: no EAS profile sets the
// flags), selecting the production builder below. It throws only when a
// dev-mode flag is present outside an isolated development launch — a
// deliberate fail-closed guard pinned by
// config/development-storefront-expo-config.test.mjs ('rejects release, CI,
// malformed mode and competing test modes'), so a stray staging flag can
// never silently misbuild as production.
const developmentStorefrontConfig = buildDevelopmentConfig(process.env);

const buildStorefrontConfig: (context: ConfigContext) => ExpoConfig =
  developmentStorefrontConfig
    ? () => developmentStorefrontConfig
    : (
        // Explicit `.ts` extension is required: the Expo loader compiles
        // this file to plain CJS without adding `.ts` extension probing,
        // so an extensionless specifier fails with MODULE_NOT_FOUND here.
        require('./config/development-storefront-expo-config-production.ts') as typeof import('./config/development-storefront-expo-config-production')
      ).buildStorefrontConfig;

export default buildStorefrontConfig;
