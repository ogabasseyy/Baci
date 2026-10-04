import type { PiggyvestClientConfig } from './client';

export function stagingPlanWalletConfig(
  config: PiggyvestClientConfig | null,
  deploymentEnvironment: string | undefined
): PiggyvestClientConfig | null {
  if (
    deploymentEnvironment === 'production' ||
    config?.baseUrl !== 'https://staging.piggyvest.business' ||
    !config.token.trim()
  ) {
    return null;
  }
  return config;
}
