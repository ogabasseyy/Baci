import 'server-only';
import { primaryWalletCardCustodySchemas as schemas } from '@/schemas/primary-wallet-card-custody';
import { createPrimaryCardCustodyExecutor } from './primary-wallet-card-custody-executor';
import { createPrimaryCardTransferLookup } from './primary-wallet-card-transfer-lookup';
import { assertPrimaryCardTransferPolicy } from './primary-wallet-card-transfer-policy';
import { createPrimaryCardTransferProvider } from './primary-wallet-card-transfer-provider';
import { runPrimaryCardTransfer } from './primary-wallet-card-transfer-worker';

export function createPrimaryCardTransferConnection(input: {
  configuration: unknown;
  fetchImplementation: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}) {
  const clock = input.now ?? Date.now;
  const config = assertPrimaryCardTransferPolicy(input.configuration, clock());
  const execute = createPrimaryCardCustodyExecutor(config.runtime);
  const submit = createPrimaryCardTransferProvider({
    ...input,
    configuration: config,
    fetchImplementation: (...parameters) => {
      input.signal?.throwIfAborted();
      return input.fetchImplementation(...parameters);
    },
  });
  const lookup = createPrimaryCardTransferLookup({
    ...input,
    configuration: config,
    fetchImplementation: (...parameters) => {
      input.signal?.throwIfAborted();
      return input.fetchImplementation(...parameters);
    },
  });
  return async (operationId: string) => {
    input.signal?.throwIfAborted();
    assertPrimaryCardTransferPolicy(config, clock());
    const selected = schemas.context.shape.operationId.parse(operationId);
    const context = schemas.context.parse(
      await execute('dispatchContext', [
        selected,
        JSON.stringify({
          ...config.runtime.crosswalkAuthority,
          merchantId: config.runtime.merchantId,
          businessId: config.runtime.businessId,
          expiresAt: config.runtime.expiresAt,
        }),
      ])
    );
    if (
      context.operationId !== selected ||
      context.integrationId !== config.runtime.integrationId ||
      context.environment !== config.runtime.environment ||
      context.merchantId !== config.runtime.merchantId ||
      context.businessId !== config.runtime.businessId
    )
      throw new Error('Transfer ownership unavailable');
    return await runPrimaryCardTransfer({
      operationId: selected,
      claim: async (selected) => {
        assertPrimaryCardTransferPolicy(config, clock());
        input.signal?.throwIfAborted();
        return await execute('claim', [selected]);
      },
      submitTransfer: (command) => submit(command, context),
      lookupTransfer: (command) => lookup(command, context),
      record: (selected, token, submitted) =>
        execute('record', [selected, token, submitted]),
    });
  };
}
