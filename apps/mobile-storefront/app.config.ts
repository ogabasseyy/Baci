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

const developmentStorefrontConfig = buildDevelopmentConfig(process.env);

const buildStorefrontConfig: (context: ConfigContext) => ExpoConfig =
  developmentStorefrontConfig
    ? () => developmentStorefrontConfig
    : (
        require('./config/development-storefront-expo-config-production.ts') as typeof import('./config/development-storefront-expo-config-production')
      ).buildStorefrontConfig;

export default buildStorefrontConfig;
