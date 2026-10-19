import 'server-only';
import {
  type PiggyvestAccruedInterestObservation,
  piggyvestAccruedInterestSchemas,
} from '@/schemas/piggyvest-accrued-interest';
import { piggyvestStagingConfigurationSchema } from '@/schemas/piggyvest-staging-configuration';
import { retrievePiggyvestStagingWallet } from './read-only-client';
import { requestPiggyvestStagingJson } from './staging-json-request';
import { resolvePiggyvestWalletMapping } from './wallet-mapping';

type AccruedInterestErrorCode =
  | 'INVALID_FETCH_IMPLEMENTATION'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_QUERY'
  | 'INVALID_IDENTITY'
  | 'INVALID_MAPPING'
  | 'WALLET_VERIFICATION_FAILED'
  | 'INTEREST_REQUEST_FAILED'
  | 'INVALID_RESPONSE';

export class PiggyvestStagingAccruedInterestError extends Error {
  constructor(readonly code: AccruedInterestErrorCode) {
    super(`PiggyVest staging accrued interest failed: ${code}.`);
    this.name = 'PiggyvestStagingAccruedInterestError';
  }
}

export async function retrievePiggyvestStagingAccruedInterest({
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
}): Promise<PiggyvestAccruedInterestObservation> {
  if (typeof fetchImplementation !== 'function') {
    throw new PiggyvestStagingAccruedInterestError(
      'INVALID_FETCH_IMPLEMENTATION'
    );
  }
  const config =
    piggyvestAccruedInterestSchemas.configuration.safeParse(configuration);
  if (!config.success) {
    throw new PiggyvestStagingAccruedInterestError('INVALID_CONFIGURATION');
  }
  const parsedQuery = piggyvestAccruedInterestSchemas.query.safeParse(query);
  if (!parsedQuery.success) {
    throw new PiggyvestStagingAccruedInterestError('INVALID_QUERY');
  }
  let trustedInput: unknown;
  try {
    trustedInput = await resolveTrustedIdentity();
  } catch {
    throw new PiggyvestStagingAccruedInterestError('INVALID_IDENTITY');
  }
  const parsedIdentity =
    piggyvestAccruedInterestSchemas.trustedIdentity.safeParse(trustedInput);
  if (!parsedIdentity.success) {
    throw new PiggyvestStagingAccruedInterestError('INVALID_IDENTITY');
  }
  const identity = parsedIdentity.data;
  if (
    identity.integrationId !== config.data.integrationId ||
    identity.merchantId !== config.data.expectedMerchantId ||
    !config.data.allowlistedCustomerIds.includes(identity.customerId)
  ) {
    throw new PiggyvestStagingAccruedInterestError('INVALID_IDENTITY');
  }
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
    throw new PiggyvestStagingAccruedInterestError('INVALID_MAPPING');
  }
  const providerConfiguration = piggyvestStagingConfigurationSchema.parse({
    apiBaseUrl: config.data.apiBaseUrl,
    apiSecret: config.data.apiSecret,
    expectedBusinessId: config.data.expectedBusinessId,
    expectedCurrency: config.data.expectedCurrency,
    timeoutMs: config.data.timeoutMs,
    maxResponseBytes: config.data.maxResponseBytes,
  });
  try {
    const wallet = await retrievePiggyvestStagingWallet({
      configuration: providerConfiguration,
      walletId: identity.providerWalletId,
      fetchImplementation,
    });
    if (wallet.data.status !== 'active') {
      throw new PiggyvestStagingAccruedInterestError(
        'WALLET_VERIFICATION_FAILED'
      );
    }
  } catch {
    throw new PiggyvestStagingAccruedInterestError(
      'WALLET_VERIFICATION_FAILED'
    );
  }
  const filters = parsedQuery.data;
  const parameters = new URLSearchParams({
    start_date: filters.start_date,
    end_date: filters.end_date,
    limit: String(filters.limit),
    interest_type: filters.interest_type,
  });
  if (filters.cursor !== undefined) parameters.set('cursor', filters.cursor);
  let response: unknown;
  try {
    response = await requestPiggyvestStagingJson({
      configuration: providerConfiguration,
      path: `/api/v1/wallet/interests/accrued/${encodeURIComponent(identity.providerWalletId)}?${parameters.toString()}`,
      method: 'GET',
      fetchImplementation,
    });
  } catch {
    throw new PiggyvestStagingAccruedInterestError('INTEREST_REQUEST_FAILED');
  }
  const parsedResponse =
    piggyvestAccruedInterestSchemas.response.safeParse(response);
  if (!parsedResponse.success) {
    throw new PiggyvestStagingAccruedInterestError('INVALID_RESPONSE');
  }
  const page = parsedResponse.data.data.paginatedPayload;
  if (
    page.edges.length > filters.limit ||
    (page.pageInfo.hasNextPage && page.pageInfo.endCursor === filters.cursor) ||
    page.edges.some(
      (row) =>
        row.wallet_id !== identity.providerWalletId ||
        row.business_id !== config.data.expectedBusinessId ||
        row.interest_type !== filters.interest_type
    )
  ) {
    throw new PiggyvestStagingAccruedInterestError('INVALID_RESPONSE');
  }
  return { monetaryUnits: 'unconfirmed', spendable: false, ...page };
}
