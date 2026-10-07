import 'server-only';
import {
  type PiggyvestCustomerFundingView,
  piggyvestCustomerFundingViewSchemas,
} from '@/schemas/piggyvest-customer-funding-view';
import { piggyvestStagingConfigurationSchema } from '@/schemas/piggyvest-staging-configuration';
import { retrievePiggyvestStagingFundingAccounts } from './funding-accounts';

export async function readPiggyvestCustomerFundingView({
  configuration,
  resolveAuthenticatedGoal,
  execute,
  fetchImplementation,
}: {
  configuration: unknown;
  resolveAuthenticatedGoal: () => Promise<unknown>;
  execute: Parameters<
    typeof retrievePiggyvestStagingFundingAccounts
  >[0]['execute'];
  fetchImplementation: typeof fetch;
}): Promise<PiggyvestCustomerFundingView> {
  try {
    const config =
      piggyvestCustomerFundingViewSchemas.configuration.safeParse(
        configuration
      );
    if (!config.success || typeof fetchImplementation !== 'function') {
      return { status: 'unavailable' };
    }
    const identity = piggyvestCustomerFundingViewSchemas.identity.safeParse(
      await resolveAuthenticatedGoal()
    );
    if (
      !identity.success ||
      identity.data.integrationId !== config.data.integrationId ||
      identity.data.merchantId !== config.data.expectedMerchantId ||
      !config.data.allowlistedCustomerIds.includes(identity.data.customerId)
    ) {
      return { status: 'unavailable' };
    }
    const providerConfiguration = piggyvestStagingConfigurationSchema.parse({
      apiBaseUrl: config.data.apiBaseUrl,
      apiSecret: config.data.apiSecret,
      expectedBusinessId: config.data.expectedBusinessId,
      expectedCurrency: config.data.expectedCurrency,
      timeoutMs: config.data.timeoutMs,
      maxResponseBytes: config.data.maxResponseBytes,
    });
    const result = await retrievePiggyvestStagingFundingAccounts({
      configuration: providerConfiguration,
      resolveTrustedIdentity: async () => identity.data,
      execute,
      fetchImplementation,
    });
    if (result.status === 'pending') return { status: 'pending' };
    return piggyvestCustomerFundingViewSchemas.view.parse({
      status: 'ready',
      accounts: result.accounts.map((account) => ({
        accountNumber: account.account_number,
        accountName: account.account_name,
        bankName: account.bank_name,
      })),
    });
  } catch {
    return { status: 'unavailable' };
  }
}
