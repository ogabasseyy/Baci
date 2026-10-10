import 'server-only';
import { primarySavingsProvisioningSchemas as schemas } from '@/schemas/primary-savings-provisioning';
import { provisionPrimarySavingsWallet } from './primary-savings-provisioning';
import { createPrimarySavingsProvisioningExecutor } from './primary-savings-provisioning-executor';
import { listPrimarySavingsProvisioningWallets } from './primary-savings-provisioning-pagination';
import { createPrimarySavingsProvisioningStore } from './primary-savings-provisioning-store';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { readPrimaryWalletRuntime } from './primary-wallet-runtime';
import { retrievePiggyvestFundingAccounts } from './wallet-funding';
import { createPiggyvestWallet, retrievePiggyvestWallet } from './wallets';

export function readPrimarySavingsProvisioningRuntime(
  env: NodeJS.ProcessEnv = process.env
) {
  if (env.PIGGYVEST_PRIMARY_SAVINGS_PROVISIONING_ENABLED !== 'true')
    return null;
  const primary = readPrimaryWalletRuntime(env);
  if (!primary) return null;
  const parsed = schemas.runtime.safeParse({
    ...primary,
    database: {
      ...primary.database,
      login: 'baci_piggyvest_primary_goal_provisioner',
      password: env.PIGGYVEST_PRIMARY_GOAL_PROVISIONER_DB_PASSWORD,
    },
  });
  return parsed.success ? parsed.data : null;
}

export async function runPrimarySavingsProvisioning(input: {
  configuration: unknown;
  scope: unknown;
  goalId: string;
  mode: 'provision' | 'recover';
  interestAccepted?: boolean;
}) {
  const configuration = schemas.runtime.parse(input.configuration);
  const scope = schemas.scope.parse(input.scope);
  const goalId = schemas.goalId.parse(input.goalId);
  if (
    scope.integrationId !== configuration.onboarding.integrationId ||
    scope.merchantId !== configuration.onboarding.merchantId ||
    scope.businessId !== configuration.onboarding.businessId ||
    scope.environment !== configuration.onboarding.environment
  )
    throw new Error('Savings provisioning configuration unavailable');
  const provider = {
    token: configuration.providerToken,
    baseUrl: getPrimaryWalletProviderOrigin(
      configuration.onboarding.environment
    ),
  };
  return await provisionPrimarySavingsWallet({
    scope,
    goalId,
    mode: input.mode,
    interestAccepted: input.interestAccepted,
    store: createPrimarySavingsProvisioningStore({
      scope,
      execute: createPrimarySavingsProvisioningExecutor(configuration),
    }),
    createWallet: (request) => createPiggyvestWallet(provider, request),
    listWallets: (customerId) =>
      listPrimarySavingsProvisioningWallets(provider, {
        customerId,
        walletName: `baci-save:${scope.integrationId}:${goalId}`,
      }),
    retrieveWallet: (walletId) => retrievePiggyvestWallet(provider, walletId),
    retrieveAccounts: (walletId) =>
      retrievePiggyvestFundingAccounts(provider, walletId),
  });
}
