import 'server-only';
import { piggyvestStagingConfigurationSchema } from '@/schemas/piggyvest-staging-configuration';
import {
  type PiggyvestTransactionListObservation,
  piggyvestTransactionListSchemas as schemas,
} from '@/schemas/piggyvest-transaction-list';
import { retrievePiggyvestStagingWallet } from './read-only-client';
import { requestPiggyvestStagingJson } from './staging-json-request';
import { resolvePiggyvestWalletMapping } from './wallet-mapping';

type ErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_QUERY'
  | 'INVALID_IDENTITY'
  | 'INVALID_MAPPING'
  | 'WALLET_VERIFICATION_FAILED'
  | 'LIST_REQUEST_FAILED'
  | 'INVALID_RESPONSE';
export class PiggyvestTransactionListError extends Error {
  constructor(readonly code: ErrorCode) {
    super(`PiggyVest transaction list failed: ${code}.`);
    this.name = 'PiggyvestTransactionListError';
  }
}

export async function retrievePiggyvestStagingTransactionList({
  configuration,
  query,
  resolveTrustedIdentity,
  execute,
  fetchImplementation,
}: {
  configuration: unknown;
  query: unknown;
  resolveTrustedIdentity: () => Promise<unknown>;
  execute: Parameters<typeof resolvePiggyvestWalletMapping>[0]['execute'];
  fetchImplementation: typeof fetch;
}): Promise<PiggyvestTransactionListObservation> {
  const config = schemas.configuration.safeParse(configuration);
  if (!config.success || typeof fetchImplementation !== 'function')
    throw new PiggyvestTransactionListError('INVALID_CONFIGURATION');
  const filters = schemas.query.safeParse(query);
  if (!filters.success)
    throw new PiggyvestTransactionListError('INVALID_QUERY');
  let trusted: unknown;
  try {
    trusted = await resolveTrustedIdentity();
  } catch {
    throw new PiggyvestTransactionListError('INVALID_IDENTITY');
  }
  const identity = schemas.identity.safeParse(trusted);
  if (
    !identity.success ||
    identity.data.integrationId !== config.data.integrationId ||
    identity.data.merchantId !== config.data.expectedMerchantId ||
    !config.data.allowlistedCustomerIds.includes(identity.data.customerId)
  )
    throw new PiggyvestTransactionListError('INVALID_IDENTITY');
  const owner = identity.data;
  const mapping = await resolvePiggyvestWalletMapping({
    configuration: {
      environment: owner.environment,
      integrationId: owner.integrationId,
      expectedMerchantId: owner.merchantId,
    },
    input: {
      providerWalletId: owner.providerWalletId,
      providerCustomerId: owner.providerCustomerId,
    },
    execute,
  });
  if (
    !mapping ||
    mapping.merchantId !== owner.merchantId ||
    mapping.customerId !== owner.customerId ||
    mapping.goalId !== owner.goalId
  )
    throw new PiggyvestTransactionListError('INVALID_MAPPING');
  const provider = piggyvestStagingConfigurationSchema.parse({
    apiBaseUrl: config.data.apiBaseUrl,
    apiSecret: config.data.apiSecret,
    expectedBusinessId: config.data.expectedBusinessId,
    expectedCurrency: config.data.expectedCurrency,
    timeoutMs: config.data.timeoutMs,
    maxResponseBytes: config.data.maxResponseBytes,
  });
  try {
    const wallet = await retrievePiggyvestStagingWallet({
      configuration: provider,
      walletId: owner.providerWalletId,
      fetchImplementation,
    });
    if (wallet.data.status !== 'active') throw new Error('Inactive wallet');
  } catch {
    throw new PiggyvestTransactionListError('WALLET_VERIFICATION_FAILED');
  }
  const parameters = new URLSearchParams({
    wallet_id: owner.providerWalletId,
    limit: String(filters.data.limit),
    collapse_batch: '0',
  });
  if (filters.data.cursor !== undefined)
    parameters.set('cursor', filters.data.cursor);
  let response: unknown;
  try {
    response = await requestPiggyvestStagingJson({
      configuration: provider,
      path: `/api/v1/transaction?${parameters.toString()}`,
      method: 'GET',
      fetchImplementation,
    });
  } catch {
    throw new PiggyvestTransactionListError('LIST_REQUEST_FAILED');
  }
  const parsed = schemas.response.safeParse(response);
  if (!parsed.success)
    throw new PiggyvestTransactionListError('INVALID_RESPONSE');
  const page = parsed.data.data;
  if (
    page.edges.length > filters.data.limit ||
    page.edges.some((row) => row.wallet_id !== owner.providerWalletId) ||
    (page.pageInfo.hasNextPage &&
      page.pageInfo.endCursor === filters.data.cursor)
  )
    throw new PiggyvestTransactionListError('INVALID_RESPONSE');
  return {
    monetaryUnits: 'kobo',
    spendable: false,
    financialEffects: 'UNKNOWN',
    edges: page.edges,
    pageInfo: page.pageInfo,
  };
}
