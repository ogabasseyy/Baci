import 'server-only';
import {
  type PiggyvestTransactionObservation,
  piggyvestTransactionReconciliationSchema as schemas,
} from '@/schemas/piggyvest-transaction-reconciliation';
import {
  PiggyvestStagingWalletRetrievalError,
  retrievePiggyvestStagingWallet,
} from './read-only-client';
import { requestPiggyvestTransaction } from './transaction-reconciliation-request';

type ReconciliationResult =
  | {
      kind: 'verified_observation';
      financialEffects: 'UNKNOWN';
      observation: PiggyvestTransactionObservation;
    }
  | {
      kind: 'needs_contract' | 'ownership_gap';
      financialEffects: 'UNKNOWN';
      reason: string;
    };

export async function reconcilePiggyvestTransaction({
  configuration,
  binding,
  fetchImplementation,
}: {
  configuration: unknown;
  binding: unknown;
  fetchImplementation: typeof fetch;
}): Promise<ReconciliationResult> {
  const settings = schemas.configuration.safeParse(configuration);
  const ownership = schemas.binding.safeParse(binding);
  const gap = (
    kind: 'needs_contract' | 'ownership_gap',
    reason: string
  ): ReconciliationResult => ({ kind, reason, financialEffects: 'UNKNOWN' });
  if (!settings.success || typeof fetchImplementation !== 'function') {
    return gap('needs_contract', 'INVALID_STAGING_CONFIGURATION');
  }
  if (!ownership.success) return gap('ownership_gap', 'INVALID_SERVER_BINDING');
  if (settings.data.expectedBusinessId !== ownership.data.businessId) {
    return gap('ownership_gap', 'BUSINESS_BINDING_MISMATCH');
  }
  try {
    await retrievePiggyvestStagingWallet({
      configuration: settings.data,
      walletId: ownership.data.walletId,
      fetchImplementation,
    });
  } catch (error) {
    if (
      error instanceof PiggyvestStagingWalletRetrievalError &&
      ['BUSINESS_ID_MISMATCH', 'WALLET_ID_MISMATCH'].includes(error.code)
    ) {
      return gap('ownership_gap', 'WALLET_BUSINESS_MISMATCH');
    }
    return gap('needs_contract', 'WALLET_VERIFICATION_UNAVAILABLE');
  }
  let response: unknown;
  try {
    response = await requestPiggyvestTransaction({
      configuration: settings.data,
      binding: ownership.data,
      fetchImplementation,
    });
  } catch {
    return gap('needs_contract', 'TRANSACTION_READ_UNAVAILABLE');
  }
  const parsed = schemas.response.safeParse(response);
  if (!parsed.success)
    return gap('needs_contract', 'TRANSACTION_PROJECTION_UNVERIFIED');
  const observation = parsed.data.data;
  if (observation.id !== ownership.data.transactionId) {
    return gap('ownership_gap', 'TRANSACTION_ID_MISMATCH');
  }
  if (observation.customer_id !== ownership.data.customerId) {
    return gap('ownership_gap', 'CUSTOMER_ID_MISMATCH');
  }
  if (
    observation.source_wallet !== ownership.data.walletId &&
    observation.destination_wallet !== ownership.data.walletId
  ) {
    return gap('ownership_gap', 'TRANSACTION_WALLET_MISMATCH');
  }
  return {
    kind: 'verified_observation',
    observation,
    financialEffects: 'UNKNOWN',
  };
}
