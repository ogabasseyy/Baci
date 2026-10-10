import 'server-only';
import { piggyvestPrimaryWalletConfigurationSchema } from '@/schemas/piggyvest-primary-wallet-onboarding';

export function getPrimaryWalletProviderOrigin(environment: unknown): string {
  return piggyvestPrimaryWalletConfigurationSchema.shape.environment.parse(
    environment
  ) === 'staging'
    ? 'https://staging.piggyvest.business'
    : 'https://api.piggyvest.business';
}
