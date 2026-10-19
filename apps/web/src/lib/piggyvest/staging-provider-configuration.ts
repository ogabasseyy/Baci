import type { PiggyvestStagingConfiguration } from '@/schemas/piggyvest-staging-configuration';

type ProviderConfiguration = Pick<
  PiggyvestStagingConfiguration,
  | 'apiBaseUrl'
  | 'apiSecret'
  | 'expectedBusinessId'
  | 'expectedCurrency'
  | 'timeoutMs'
  | 'maxResponseBytes'
>;

export function projectPiggyvestStagingProviderConfiguration(
  configuration: ProviderConfiguration
): ProviderConfiguration {
  return {
    apiBaseUrl: configuration.apiBaseUrl,
    apiSecret: configuration.apiSecret,
    expectedBusinessId: configuration.expectedBusinessId,
    expectedCurrency: configuration.expectedCurrency,
    timeoutMs: configuration.timeoutMs,
    maxResponseBytes: configuration.maxResponseBytes,
  };
}
