import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { buildDevelopmentStorefrontExpoConfig as buildDevelopmentConfig } from './config/development-storefront-expo-config';

const developmentStorefrontConfig = buildDevelopmentConfig(process.env);
if (process.env.NODE_ENV !== 'test' && !developmentStorefrontConfig) {
  require('dotenv').config({
    path: path.resolve(__dirname, '.env'),
    quiet: true,
  });
}

const buildStorefrontConfig: (context: ConfigContext) => ExpoConfig =
  developmentStorefrontConfig
    ? () => developmentStorefrontConfig
    : (
        require('./config/development-storefront-expo-config-production.ts') as typeof import('./config/development-storefront-expo-config-production')
      ).buildStorefrontConfig;

export default buildStorefrontConfig;
