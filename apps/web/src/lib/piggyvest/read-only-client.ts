import 'server-only';
import { piggyvestStagingConfigurationSchema } from '@/schemas/piggyvest-staging-configuration';
import {
  type PiggyvestStagingWalletResponse,
  piggyvestStagingWalletResponseSchema,
} from '@/schemas/piggyvest-staging-wallet';
import { requestPiggyvestStagingJson } from './staging-json-request';
import { PiggyvestStagingJsonRequestError } from './staging-json-request.errors';

type PiggyvestStagingWalletRetrievalErrorCode =
  | 'BODY_READ_ERROR'
  | 'BUSINESS_ID_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'HTTP_STATUS'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_RESPONSE'
  | 'INVALID_WALLET_ID'
  | 'NETWORK_ERROR'
  | 'RESPONSE_TOO_LARGE'
  | 'TIMEOUT'
  | 'WALLET_ID_MISMATCH';

export class PiggyvestStagingWalletRetrievalError extends Error {
  constructor(readonly code: PiggyvestStagingWalletRetrievalErrorCode) {
    super(`PiggyVest staging wallet retrieval failed: ${code}.`);
    this.name = 'PiggyvestStagingWalletRetrievalError';
  }
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const characterCode = character.charCodeAt(0);
    return characterCode <= 31 || characterCode === 127;
  });
}

export async function retrievePiggyvestStagingWallet({
  configuration,
  walletId,
  fetchImplementation,
}: {
  configuration: unknown;
  walletId: unknown;
  fetchImplementation: typeof fetch;
}): Promise<PiggyvestStagingWalletResponse> {
  const parsedConfiguration =
    piggyvestStagingConfigurationSchema.safeParse(configuration);
  if (!parsedConfiguration.success) {
    throw new PiggyvestStagingWalletRetrievalError('INVALID_CONFIGURATION');
  }
  if (typeof walletId !== 'string') {
    throw new PiggyvestStagingWalletRetrievalError('INVALID_WALLET_ID');
  }
  const requestedWalletId = walletId.trim();
  if (
    !requestedWalletId ||
    requestedWalletId.length > 512 ||
    !requestedWalletId.isWellFormed() ||
    hasControlCharacters(requestedWalletId) ||
    requestedWalletId
      .split('/')
      .some((segment) => segment === '.' || segment === '..')
  ) {
    throw new PiggyvestStagingWalletRetrievalError('INVALID_WALLET_ID');
  }

  let parsedBody: unknown;
  try {
    parsedBody = await requestPiggyvestStagingJson({
      configuration: parsedConfiguration.data,
      path: `/api/v1/wallet/${encodeURIComponent(requestedWalletId)}`,
      method: 'GET',
      fetchImplementation,
    });
  } catch (error) {
    if (error instanceof PiggyvestStagingJsonRequestError) {
      throw new PiggyvestStagingWalletRetrievalError(
        error.code === 'INVALID_REQUEST' ? 'INVALID_WALLET_ID' : error.code
      );
    }
    throw new PiggyvestStagingWalletRetrievalError('NETWORK_ERROR');
  }

  const parsedResponse =
    piggyvestStagingWalletResponseSchema.safeParse(parsedBody);
  if (!parsedResponse.success) {
    throw new PiggyvestStagingWalletRetrievalError('INVALID_RESPONSE');
  }
  if (parsedResponse.data.data.id !== requestedWalletId) {
    throw new PiggyvestStagingWalletRetrievalError('WALLET_ID_MISMATCH');
  }
  if (
    parsedResponse.data.data.business_id !==
    parsedConfiguration.data.expectedBusinessId
  ) {
    throw new PiggyvestStagingWalletRetrievalError('BUSINESS_ID_MISMATCH');
  }
  if (
    parsedResponse.data.data.currency !==
    parsedConfiguration.data.expectedCurrency
  ) {
    throw new PiggyvestStagingWalletRetrievalError('CURRENCY_MISMATCH');
  }
  return parsedResponse.data;
}
