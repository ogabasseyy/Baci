import 'server-only';
import { createHash } from 'node:crypto';
import { piggyvestPrimaryWalletStoreSchemas as schemas } from '@/schemas/piggyvest-primary-wallet-store';
import { primarySavingsProvisioningSchemas } from '@/schemas/primary-savings-provisioning';

export function getPrimarySavingsWalletName(
  integrationId: string,
  goalId: string
) {
  const integration = schemas.scope.shape.integrationId.parse(integrationId);
  const goal = primarySavingsProvisioningSchemas.goalId.parse(goalId);
  const digest = createHash('sha256')
    .update(`${integration}:${goal}`)
    .digest('hex')
    .slice(0, 32);
  return `BaciSavings${digest}`;
}
