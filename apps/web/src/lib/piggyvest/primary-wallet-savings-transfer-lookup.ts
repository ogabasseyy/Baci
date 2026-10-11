import 'server-only';
import { prefundedCardTransferVerificationSchemas as verification } from '@/schemas/prefunded-card-transfer-verification';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

export async function lookupSavingsTransferReference(input: {
  reference: string;
  walletId: string;
  amountKobo: number;
  destinationWalletId: string;
  token: string;
  baseUrl: string;
  fetchImplementation?: typeof fetch;
}): Promise<'submitted' | 'absent' | 'uncertain'> {
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
    // Only an authoritative 404 proves the previous holder died before
    // submitting. Any other failure stays uncertain so the caller records
    // unknown instead of risking a double submission.
    if (
      error instanceof Error &&
      (error as Error & { httpStatus?: unknown }).httpStatus === 404
    )
      return 'absent';
    return 'uncertain';
  }
  const rich = verification.rich.safeParse(response);
  if (
    rich.success &&
    rich.data.data.third_party_reference === input.reference &&
    rich.data.data.amount === input.amountKobo &&
    rich.data.data.source_wallet === input.walletId &&
    rich.data.data.destination_wallet === input.destinationWalletId
  )
    return 'submitted';
  const normalized = verification.normalized.safeParse(response);
  if (
    normalized.success &&
    normalized.data.data.reference === input.reference &&
    normalized.data.data.amount === input.amountKobo &&
    normalized.data.data.source_wallet === input.walletId &&
    normalized.data.data.destination_wallet === input.destinationWalletId
  )
    return 'submitted';
  return 'uncertain';
}
