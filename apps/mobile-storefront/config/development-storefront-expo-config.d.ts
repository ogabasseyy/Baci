import type { ExpoConfig } from 'expo/config';

export function buildDevelopmentStorefrontExpoConfig(
  environment: Readonly<Record<string, string | undefined>>
): ExpoConfig | null;
