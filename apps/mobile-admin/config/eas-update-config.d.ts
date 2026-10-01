import type { ExpoConfig } from 'expo/config';

export const EAS_PROJECT_ID: string;
export const EAS_UPDATE_URL: string;

export function buildEasUpdateConfig(
  environment?: Readonly<Record<string, string | undefined>>
): {
  easProjectId: string;
  runtimeVersion: NonNullable<ExpoConfig['runtimeVersion']>;
  updates: NonNullable<ExpoConfig['updates']>;
};

export function createExpoDevClientPlugin(): [
  'expo-dev-client',
  { launchMode: 'most-recent' },
];
