import 'server-only';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import {
  classifyTransferReferenceFailure,
  classifyTransferReferenceResponse,
  type TransferReferenceLookup,
} from './transfer-reference-lookup';

export async function lookupSavingsTransferReference(input: {
  reference: string;
  walletId: string;
  amountKobo: number;
  destinationWalletId: string;
  token: string;
  baseUrl: string;
  fetchImplementation?: typeof fetch;
}): Promise<TransferReferenceLookup> {
  let response: unknown;
  try {
    response = await requestPrefundedCardProviderJson({
      url: `${input.baseUrl}/api/v1/transaction/verify?reference=${encodeURIComponent(input.reference)}&wallet_id=${encodeURIComponent(input.walletId)}`,
      token: input.token,
      timeoutMs: 5000,
      maxResponseBytes: 65536,
      fetchImplementation: input.fetchImplementation ?? fetch,
      init: { method: 'GET' },
    });
  } catch (error) {
    // A 404 is 'not_found', never proof that nothing was submitted: a
    // just-accepted transfer answers 404 until PiggyVest indexes it.
    return classifyTransferReferenceFailure(error);
  }
  return classifyTransferReferenceResponse(response, {
    reference: input.reference,
    amountKobo: input.amountKobo,
    sourceWalletId: input.walletId,
    destinationWalletId: input.destinationWalletId,
  });
}
