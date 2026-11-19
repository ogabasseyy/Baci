import 'server-only';
import { primaryWalletCardCustodySchemas as schemas } from '@/schemas/primary-wallet-card-custody';
import { createPrimaryCardCustodyExecutor } from './primary-wallet-card-custody-executor';
import { createPrimaryCardCustodyReader } from './primary-wallet-card-custody-reader';
import { applyPrimaryCardSignedCustody } from './primary-wallet-card-custody-signed';
import { runPrimaryCardTransfer } from './primary-wallet-card-transfer-worker';

export function createPrimaryCardCustodyConnection(input: {
  configuration: unknown;
  fetchImplementation: typeof fetch;
  resolveAuthenticatedCrosswalk: Parameters<
    typeof createPrimaryCardCustodyReader
  >[0]['resolveAuthenticatedCrosswalk'];
  submitApprovedTransfer: Parameters<
    typeof runPrimaryCardTransfer
  >[0]['submitTransfer'];
  lookupApprovedTransfer: Parameters<
    typeof runPrimaryCardTransfer
  >[0]['lookupTransfer'];
  now?: () => number;
}) {
  const config = schemas.runtime.parse(input.configuration);
  const execute = createPrimaryCardCustodyExecutor(config);
  const observe = createPrimaryCardCustodyReader({
    ...input,
    configuration: config,
  });
  const active = () => {
    const now = (input.now ?? Date.now)();
    if (!Number.isFinite(now) || now >= Date.parse(config.expiresAt))
      throw new Error('Custody deployment unavailable');
  };
  return {
    async dispatch(operationId: string) {
      active();
      const selected = schemas.context.shape.operationId.parse(operationId);
      const context = schemas.context.parse(
        await execute('context', [selected])
      );
      if (
        context.operationId !== selected ||
        context.integrationId !== config.integrationId ||
        context.environment !== config.environment ||
        context.merchantId !== config.merchantId ||
        context.businessId !== config.businessId
      )
        throw new Error('Custody deployment unavailable');
      return await runPrimaryCardTransfer({
        operationId,
        claim: (selected) => execute('claim', [selected]),
        submitTransfer: async (command) => {
          active();
          if (
            command.operationId !== context.operationId ||
            command.reference !== context.reference ||
            command.sourceWalletId !== context.sourceWalletId ||
            command.destinationWalletId !== context.destinationWalletId ||
            command.amountKobo !== context.amountKobo ||
            command.currency !== 'NGN'
          )
            throw new Error('Transfer ownership unavailable');
          await input.submitApprovedTransfer(command);
        },
        lookupTransfer: async (command) => {
          active();
          if (
            command.operationId !== context.operationId ||
            command.reference !== context.reference ||
            command.sourceWalletId !== context.sourceWalletId ||
            command.destinationWalletId !== context.destinationWalletId ||
            command.amountKobo !== context.amountKobo ||
            command.currency !== 'NGN'
          )
            throw new Error('Transfer ownership unavailable');
          return await input.lookupApprovedTransfer(command);
        },
        record: (selected, token, submitted) =>
          execute('record', [selected, token, submitted]),
      });
    },
    async applySignedCustody(input: {
      operationId: string;
      rawBody: Uint8Array;
      signature: string | null;
      inboxToken: string;
    }) {
      active();
      return await applyPrimaryCardSignedCustody({
        ...input,
        secret: config.webhookSecret,
        retainedSecrets: config.retainedWebhookSecrets,
        now: inputNow,
        loadContext: (selected) => execute('context', [selected]),
        observe,
        settle: (proof) => {
          active();
          return execute('settle', [JSON.stringify(proof)]);
        },
      });
    },
  };
  function inputNow() {
    return (input.now ?? Date.now)();
  }
}
