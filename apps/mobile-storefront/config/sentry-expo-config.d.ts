import type { ExpoConfig } from 'expo/config';

type ExpoPlugin = NonNullable<ExpoConfig['plugins']>[number];

export function buildSentryExpoConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  options: { required: boolean }
): { plugin: ExpoPlugin | null };
