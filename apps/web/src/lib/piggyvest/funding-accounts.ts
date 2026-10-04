import 'server-only';
import {
  type PiggyvestFundingAccount,
  piggyvestFundingAccountsSchemas,
} from '@/schemas/piggyvest-funding-accounts';
import { piggyvestStagingConfigurationSchema } from '@/schemas/piggyvest-staging-configuration';
import { retrievePiggyvestStagingWallet } from './read-only-client';
import { requestPiggyvestStagingJson } from './staging-json-request';
import { resolvePiggyvestWalletMapping } from './wallet-mapping';

type FundingAccountsErrorCode =
  | 'INVALID_FETCH_IMPLEMENTATION'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_IDENTITY'
  | 'INVALID_MAPPING'
  | 'WALLET_VERIFICATION_FAILED'
  | 'ACCOUNTS_REQUEST_FAILED'
  | 'INVALID_RESPONSE';

export class PiggyvestStagingFundingAccountsError extends Error {
  constructor(readonly code: FundingAccountsErrorCode) {
    super(`PiggyVest staging funding accounts failed: ${code}.`);
    this.name = 'PiggyvestStagingFundingAccountsError';
  }
}

export async function retrievePiggyvestStagingFundingAccounts({
  configuration,
  resolveTrustedIdentity,
  execute,
  fetchImplementation,
}: {
  configuration: unknown;
  resolveTrustedIdentity: () => Promise<unknown>;
  execute: Parameters<typeof resolvePiggyvestWalletMapping>[0]['execute'];
  fetchImplementation: typeof fetch;
}): Promise<{
  status: 'pending' | 'ready';
  accounts: PiggyvestFundingAccount[];
}> {
  if (typeof fetchImplementation !== 'function') {
    throw new PiggyvestStagingFundingAccountsError(
      'INVALID_FETCH_IMPLEMENTATION'
    );
  }
  const config = piggyvestStagingConfigurationSchema.safeParse(configuration);
  if (!config.success) {
    throw new PiggyvestStagingFundingAccountsError('INVALID_CONFIGURATION');
  }
  let trustedInput: unknown;
  try {
    trustedInput = await resolveTrustedIdentity();
  } catch {
    throw new PiggyvestStagingFundingAccountsError('INVALID_IDENTITY');
  }
  const parsedIdentity =
    piggyvestFundingAccountsSchemas.trustedIdentity.safeParse(trustedInput);
  if (!parsedIdentity.success) {
    throw new PiggyvestStagingFundingAccountsError('INVALID_IDENTITY');
  }
  const identity = parsedIdentity.data;
  const mapping = await resolvePiggyvestWalletMapping({
    configuration: {
      environment: identity.environment,
      integrationId: identity.integrationId,
      expectedMerchantId: identity.merchantId,
    },
    input: {
      providerWalletId: identity.providerWalletId,
      providerCustomerId: identity.providerCustomerId,
    },
    execute,
  });
  if (
    !mapping ||
    mapping.merchantId !== identity.merchantId ||
    mapping.customerId !== identity.customerId ||
    mapping.goalId !== identity.goalId
  ) {
    throw new PiggyvestStagingFundingAccountsError('INVALID_MAPPING');
  }

  try {
    const wallet = await retrievePiggyvestStagingWallet({
      configuration: config.data,
      walletId: identity.providerWalletId,
      fetchImplementation,
    });
    if (wallet.data.status !== 'active') {
      throw new PiggyvestStagingFundingAccountsError(
        'WALLET_VERIFICATION_FAILED'
      );
    }
  } catch {
    throw new PiggyvestStagingFundingAccountsError(
      'WALLET_VERIFICATION_FAILED'
    );
  }
  let response: unknown;
  try {
    response = await requestPiggyvestStagingJson({
      configuration: config.data,
      path: `/api/v1/wallet/${encodeURIComponent(identity.providerWalletId)}/accounts`,
      method: 'GET',
      fetchImplementation,
    });
  } catch {
    throw new PiggyvestStagingFundingAccountsError('ACCOUNTS_REQUEST_FAILED');
  }
  const parsedResponse =
    piggyvestFundingAccountsSchemas.response.safeParse(response);
  if (!parsedResponse.success) {
    throw new PiggyvestStagingFundingAccountsError('INVALID_RESPONSE');
  }
  return {
    status: parsedResponse.data.data.length === 0 ? 'pending' : 'ready',
    accounts: parsedResponse.data.data,
  };
}
