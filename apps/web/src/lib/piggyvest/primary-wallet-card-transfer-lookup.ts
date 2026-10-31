import 'server-only';
import { primaryWalletCardCustodySchemas as custody } from '@/schemas/primary-wallet-card-custody';
import { primaryCardTransferProviderSchemas as schemas } from '@/schemas/primary-wallet-card-transfer-provider';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { assertPrimaryCardTransferPolicy } from './primary-wallet-card-transfer-policy';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import {
  classifyTransferReferenceFailure,
  classifyTransferReferenceResponse,
  type TransferReferenceLookup,
} from './transfer-reference-lookup';

export function createPrimaryCardTransferLookup(input: {
  configuration: unknown;
  fetchImplementation: typeof fetch;
  now?: () => number;
}) {
  const config = schemas.configuration.parse(input.configuration);
  return async (
    selected: unknown,
    ownership: unknown
  ): Promise<TransferReferenceLookup> => {
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
      // A 404 is 'not_found', never proof that the previous holder died
      // before submitting: a just-accepted transfer answers 404 until
      // PiggyVest indexes it. The worker never resubmits on it.
      return classifyTransferReferenceFailure(error);
    }
    return classifyTransferReferenceResponse(response, {
      reference: command.reference,
      amountKobo: command.amountKobo,
      sourceWalletId: command.sourceWalletId,
      destinationWalletId: command.destinationWalletId,
    });
  };
}
