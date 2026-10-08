import 'server-only';
import { primaryWalletCardCustodySchemas as custody } from '@/schemas/primary-wallet-card-custody';
import { primaryCardTransferProviderSchemas as schemas } from '@/schemas/primary-wallet-card-transfer-provider';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { assertPrimaryCardTransferPolicy } from './primary-wallet-card-transfer-policy';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';

export function createPrimaryCardTransferProvider(input: {
  configuration: unknown;
  fetchImplementation: typeof fetch;
  now?: () => number;
}) {
  const config = schemas.configuration.parse(input.configuration);
  return async (selected: unknown, ownership: unknown): Promise<void> => {
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
    const origin = getPrimaryWalletProviderOrigin(context.environment);
    const response = await requestPrefundedCardProviderJson({
      url: `${origin}/api/v1/transfer/wallet`,
      token: config.runtime.apiToken,
      timeoutMs: 5000,
      maxResponseBytes: 65536,
      fetchImplementation: input.fetchImplementation,
      init: {
        method: 'POST',
        body: JSON.stringify({
          amount: command.amountKobo,
          source: command.sourceWalletId,
          destination: command.destinationWalletId,
          currency: command.currency,
          reference: command.reference,
        }),
      },
    });
    schemas.accepted.parse(response);
  };
}
