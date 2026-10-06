import 'server-only';
import { piggyvestProvisioningConfigurationSchema } from '@/schemas/piggyvest-provisioning-configuration';
import type { PiggyvestSavingsPlanFundingResponse } from '@/schemas/piggyvest-savings-plan-funding';
import {
  PiggyvestStagingFundingAccountsError,
  retrievePiggyvestStagingFundingAccounts,
} from './funding-accounts';
import { provisionPiggyvestStagingResource } from './provisioning-client';
import { recoverPiggyvestProvisioning } from './provisioning-recovery-client';
import { createPiggyvestProvisioningRecoveryStore } from './provisioning-recovery-store';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { projectPiggyvestStagingProviderConfiguration } from './staging-provider-configuration';
import { recordPiggyvestWalletMapping } from './wallet-mapping';

type EnsureInput = {
  configuration: unknown;
  customer: {
    merchantId: string;
    customerId: string;
    goalId: string;
    bvn: string;
    name: string;
    email: string;
    phone: string;
  };
  options: {
    reserveVirtualAccount: boolean;
    enableInterestAccrual: boolean;
  };
  execute: PiggyvestProvisioningExecutor;
  fetchImplementation: typeof fetch;
};

type StoredIds = {
  providerCustomerId: string | null;
  providerWalletId: string | null;
};

export async function ensurePiggyvestPlanFunding(
  input: EnsureInput
): Promise<PiggyvestSavingsPlanFundingResponse> {
  const parsed = piggyvestProvisioningConfigurationSchema.safeParse(
    input.configuration
  );
  if (
    !parsed.success ||
    parsed.data.expectedMerchantId !== input.customer.merchantId ||
    !parsed.data.allowlistedCustomerIds.includes(input.customer.customerId)
  ) {
    return { status: 'unavailable', code: 'NOT_CONFIGURED' };
  }
  const config = parsed.data;
  const storage = {
    environment: config.environment,
    integrationId: config.integrationId,
    expectedMerchantId: config.expectedMerchantId,
    expectedBusinessId: config.expectedBusinessId,
  };

  async function readStoredIds(
    intentId: string,
    goalId: string | null
  ): Promise<StoredIds | null> {
    try {
      const row = await createPiggyvestProvisioningRecoveryStore({
        configuration: storage,
        execute: input.execute,
      }).read({ intentId, customerId: input.customer.customerId, goalId });
      if (!row) return null;
      return {
        providerCustomerId: row.provider_customer_id,
        providerWalletId: row.provider_wallet_id,
      };
    } catch {
      return null;
    }
  }

  async function settleKind(
    command: unknown,
    goalId: string | null,
    needWallet: boolean
  ): Promise<
    | { outcome: 'ready'; ids: StoredIds }
    | { outcome: 'pending' }
    | {
        outcome: 'failed';
        reason: 'not_ready' | 'conflict' | 'existing_customer_unowned';
      }
  > {
    let provision: Awaited<
      ReturnType<typeof provisionPiggyvestStagingResource>
    >;
    try {
      provision = await provisionPiggyvestStagingResource({
        configuration: input.configuration,
        command,
        execute: input.execute,
        fetchImplementation: input.fetchImplementation,
      });
    } catch {
      return { outcome: 'pending' };
    }
    if (provision.status === 'not_ready')
      return { outcome: 'failed', reason: 'not_ready' };
    if (provision.status === 'conflict')
      return { outcome: 'failed', reason: 'conflict' };
    if (provision.status === 'existing_customer_unowned')
      return { outcome: 'failed', reason: 'existing_customer_unowned' };
    if (!provision.intentId) return { outcome: 'pending' };
    if (provision.status === 'already_dispatched') {
      try {
        await recoverPiggyvestProvisioning({
          configuration: {
            storage,
            wallet: projectPiggyvestStagingProviderConfiguration(config),
          },
          scope: {
            intentId: provision.intentId,
            customerId: input.customer.customerId,
            goalId,
          },
          execute: input.execute,
          fetchImplementation: input.fetchImplementation,
        });
      } catch {
        return { outcome: 'pending' };
      }
    }
    const stored = await readStoredIds(provision.intentId, goalId);
    if (!stored?.providerCustomerId) return { outcome: 'pending' };
    if (needWallet && !stored.providerWalletId) return { outcome: 'pending' };
    return { outcome: 'ready', ids: stored };
  }

  let customerMapping: {
    outcome: 'none' | 'mapped' | 'conflict' | 'disabled' | 'business_mismatch';
    provider_customer_id: string | null;
  };
  try {
    customerMapping = await createPiggyvestProvisioningRecoveryStore({
      configuration: storage,
      execute: input.execute,
    }).readCustomerMapping(input.customer.customerId);
  } catch {
    return { status: 'pending', code: 'PROVISIONING_IN_PROGRESS' };
  }
  if (
    customerMapping.outcome === 'conflict' ||
    customerMapping.outcome === 'disabled' ||
    customerMapping.outcome === 'business_mismatch'
  ) {
    return { status: 'unavailable', code: 'PROVIDER_UNAVAILABLE' };
  }

  const customerStep =
    customerMapping.outcome === 'mapped'
      ? {
          outcome: 'ready' as const,
          ids: {
            providerCustomerId: customerMapping.provider_customer_id,
            providerWalletId: null,
          },
        }
      : await settleKind(
          {
            kind: 'create_customer',
            merchantId: input.customer.merchantId,
            customerId: input.customer.customerId,
            bvn: input.customer.bvn,
            name: input.customer.name,
            email: input.customer.email,
            phone: input.customer.phone,
            enableInterestAccrual: false,
            interestPayout: 'own_wallet',
          },
          null,
          false
        );
  if (customerStep.outcome === 'failed')
    return {
      status: 'unavailable',
      code:
        customerStep.reason === 'conflict' ||
        customerStep.reason === 'existing_customer_unowned'
          ? 'PROVIDER_UNAVAILABLE'
          : 'NOT_CONFIGURED',
    };
  if (customerStep.outcome !== 'ready' || !customerStep.ids.providerCustomerId)
    return { status: 'pending', code: 'PROVISIONING_IN_PROGRESS' };

  const walletStep = await settleKind(
    {
      kind: 'create_plan_wallet',
      merchantId: input.customer.merchantId,
      customerId: input.customer.customerId,
      goalId: input.customer.goalId,
      providerCustomerId: customerStep.ids.providerCustomerId,
      customerName: input.customer.name,
      reserveVirtualAccount: input.options.reserveVirtualAccount,
      enableInterestAccrual: input.options.enableInterestAccrual,
      interestPayout: 'own_wallet',
    },
    input.customer.goalId,
    true
  );
  if (walletStep.outcome === 'failed')
    return { status: 'unavailable', code: 'PROVIDER_UNAVAILABLE' };
  if (walletStep.outcome !== 'ready' || !walletStep.ids.providerWalletId)
    return { status: 'pending', code: 'PROVISIONING_IN_PROGRESS' };

  const providerCustomerId = walletStep.ids.providerCustomerId;
  const providerWalletId = walletStep.ids.providerWalletId;
  const mappingRecorded = await recordPiggyvestWalletMapping({
    configuration: {
      environment: config.environment,
      integrationId: config.integrationId,
      expectedMerchantId: config.expectedMerchantId,
    },
    input: {
      providerWalletId,
      providerCustomerId,
      merchantId: input.customer.merchantId,
      customerId: input.customer.customerId,
      goalId: input.customer.goalId,
    },
    execute: input.execute,
  });
  if (!mappingRecorded) {
    // The binding is the only durable link between the dedicated wallet
    // and its goal: funding-accounts retrieval requires it, and so do
    // inflow/interest intake. Stay pending (idempotent re-record on
    // retry) rather than returning accounts no webhook can attribute.
    return { status: 'pending', code: 'MAPPING_PENDING' };
  }
  try {
    const funding = await retrievePiggyvestStagingFundingAccounts({
      configuration: projectPiggyvestStagingProviderConfiguration(config),
      resolveTrustedIdentity: async () => ({
        environment: 'staging' as const,
        integrationId: config.integrationId,
        merchantId: input.customer.merchantId,
        customerId: input.customer.customerId,
        goalId: input.customer.goalId,
        providerWalletId,
        providerCustomerId,
      }),
      execute: input.execute,
      fetchImplementation: input.fetchImplementation,
    });
    if (funding.status === 'pending')
      return { status: 'pending', code: 'PROVISIONING_IN_PROGRESS' };
    return {
      status: 'ready',
      accounts: funding.accounts.map((account) => ({
        accountNumber: account.account_number,
        accountName: account.account_name,
        bankName: account.bank_name,
      })),
    };
  } catch (error) {
    if (error instanceof PiggyvestStagingFundingAccountsError) {
      if (error.code === 'INVALID_MAPPING')
        return { status: 'pending', code: 'MAPPING_PENDING' };
      if (
        error.code === 'INVALID_CONFIGURATION' ||
        error.code === 'INVALID_IDENTITY'
      )
        return { status: 'unavailable', code: 'NOT_CONFIGURED' };
    }
    return { status: 'pending', code: 'PROVIDER_UNAVAILABLE' };
  }
}
