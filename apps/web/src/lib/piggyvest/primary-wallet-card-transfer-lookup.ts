import 'server-only';
import { prefundedCardTransferVerificationSchemas as verification } from '@/schemas/prefunded-card-transfer-verification';
import { primaryWalletCardCustodySchemas as custody } from '@/schemas/primary-wallet-card-custody';
import { primaryCardTransferProviderSchemas as schemas } from '@/schemas/primary-wallet-card-transfer-provider';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { assertPrimaryCardTransferPolicy } from './primary-wallet-card-transfer-policy';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';

export function createPrimaryCardTransferLookup(input: {
  configuration: unknown;
  fetchImplementation: typeof fetch;
  now?: () => number;
}) {
  const config = schemas.configuration.parse(input.configuration);
  return async (
    selected: unknown,
    ownership: unknown
  ): Promise<'submitted' | 'absent' | 'uncertain'> => {
    assertPrimaryCardTransferPolicy(config, (input.now ?? Date.now)());
    const command = custody.command.parse(selected);
    const context = custody.context.parse(ownership);
    if (
      context.integrationId !== config.runtime.integrationId ||
      context.environment !== config.runtime.environment ||
      context.merchantId !== config.runtime.merchantId ||
      context.businessId !== config.runtime.businessId ||
      command.operationId !== context.operationId ||
      command.reference !== context.reference ||
      command.sourceWalletId !== context.sourceWalletId ||
      command.destinationWalletId !== context.destinationWalletId ||
      command.amountKobo !== context.amountKobo ||
      command.currency !== 'NGN'
    )
      throw new Error('Transfer ownership unavailable');
    let response: unknown;
    try {
      const origin = getPrimaryWalletProviderOrigin(context.environment);
      response = await requestPrefundedCardProviderJson({
        url: `${origin}/api/v1/transaction/verify?reference=${encodeURIComponent(command.reference)}&wallet_id=${encodeURIComponent(command.sourceWalletId)}`,
        token: config.runtime.apiToken,
        timeoutMs: 5000,
        maxResponseBytes: 65536,
        fetchImplementation: input.fetchImplementation,
        init: { method: 'GET' },
      });
    } catch (error) {
      // Only an authoritative 404 proves the previous holder died before
      // submitting. Any other failure — timeout, 5xx, malformed body —
      // stays uncertain so the worker records an unknown outcome instead
      // of risking a double submission.
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
      rich.data.data.third_party_reference === command.reference &&
      rich.data.data.amount === command.amountKobo &&
      rich.data.data.source_wallet === command.sourceWalletId &&
      rich.data.data.destination_wallet === command.destinationWalletId
    )
      return 'submitted';
    const normalized = verification.normalized.safeParse(response);
    if (
      normalized.success &&
      normalized.data.data.reference === command.reference &&
      normalized.data.data.amount === command.amountKobo &&
      normalized.data.data.source_wallet === command.sourceWalletId &&
      normalized.data.data.destination_wallet === command.destinationWalletId
    )
      return 'submitted';
    return 'uncertain';
  };
}
