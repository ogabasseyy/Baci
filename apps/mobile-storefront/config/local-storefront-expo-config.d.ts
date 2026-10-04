import type { ExpoConfig } from 'expo/config';

export function buildLocalStorefrontExpoConfig(
  environment: Readonly<Record<string, string | undefined>>
): ExpoConfig | null;
