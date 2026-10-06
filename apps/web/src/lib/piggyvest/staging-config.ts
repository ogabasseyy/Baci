import 'server-only';
import {
  PIGGYVEST_STAGING_API_ORIGIN,
  piggyvestStagingConfigurationSchema,
} from '@/schemas/piggyvest-staging-configuration';

export { PIGGYVEST_STAGING_API_ORIGIN };

export function createPiggyvestStagingConfiguration(input: unknown) {
  return piggyvestStagingConfigurationSchema.parse(input);
}
