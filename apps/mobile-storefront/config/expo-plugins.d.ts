import type { TikTokBusinessPlugin } from '@baci/tiktok-business';
import type { ExpoConfig } from 'expo/config';

type ExpoPlugin = NonNullable<ExpoConfig['plugins']>[number];

interface ExpoPluginsOptions {
  facebookSdkPlugin: ExpoPlugin | null;
  sentryPlugin: ExpoPlugin | null;
  tiktokBusinessPlugin: TikTokBusinessPlugin | null;
}

export function createExpoPlugins(
  options: ExpoPluginsOptions
): NonNullable<ExpoConfig['plugins']>;
