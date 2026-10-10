import 'server-only';
import { prefundedCardProviderSchemas } from '@/schemas/prefunded-card-provider';
import { prefundedCardReversalSchemas as schemas } from '@/schemas/prefunded-card-reversal';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { createPrefundedCardReversalStore } from './prefunded-card-reversal.store';

export function createPrefundedCardReversalHandler(input: {
  execute: Parameters<typeof createPrefundedCardReversalStore>[0];
  expectedSystemId: string;
  settings: unknown;
  fetchImplementation: typeof fetch;
  resolveSavedMethod: (identity: {
    savedMethodId: string;
    merchantId: string;
    customerId: string;
  }) => Promise<unknown>;
}) {
  const settings = prefundedCardProviderSchemas.settings.parse(input.settings);
  const store = createPrefundedCardReversalStore(
    input.execute,
    input.expectedSystemId
  );
  return async (operationId: unknown, deliveryId: unknown) => {
    let identifier: string;
    let eventId: string;
    try {
      identifier = schemas.uuid.parse(operationId);
      eventId = schemas.eventId.parse(deliveryId);
    } catch {
      throw new Error('Prefunded reversal unavailable');
    }
    const context = await store.readContext(identifier);
    const claim = context.request;
    if (
      claim.integrationId !== settings.scope.integrationId ||
      claim.merchantId !== settings.scope.merchantId ||
      claim.treasuryBindingId !== settings.scope.treasuryBindingId ||
      claim.sourceWalletId !== settings.scope.sourceWalletId ||
      claim.businessId !== settings.piggyvest.expectedBusinessId
    )
      return { outcome: 'reconciliation_required' } as const;
    let command: ReturnType<typeof schemas.command.parse>;
    try {
      const method = prefundedCardProviderSchemas.savedMethod.parse(
        await input.resolveSavedMethod({
          savedMethodId: claim.savedMethodId,
          merchantId: claim.merchantId,
          customerId: claim.customerId,
        })
      );
      if (
        method.savedMethodId !== claim.savedMethodId ||
        method.merchantId !== claim.merchantId ||
        method.customerId !== claim.customerId
      )
        return { outcome: 'reconciliation_required' } as const;
      const response = schemas.providerResponse.parse(
        await requestPrefundedCardProviderJson({
          url: `https://api.paystack.co/transaction/verify/${encodeURIComponent(claim.collectionReference)}`,
          token: settings.paystackSecret,
          timeoutMs: settings.paystackTimeoutMs,
          maxResponseBytes: settings.piggyvest.maxResponseBytes,
          fetchImplementation: input.fetchImplementation,
          init: { method: 'GET' },
        })
      );
      const data = response.data;
      if (
        data.reference !== claim.collectionReference ||
        data.amount !== claim.amountKobo ||
        data.currency !== claim.currency ||
        data.customer.customer_code !== method.paystackCustomerCode ||
        data.customer.email !== method.email ||
        data.authorization.authorization_code !== method.authorizationCode ||
        (context.collectionTransactionId !== null &&
          data.id !== context.collectionTransactionId)
      )
        return { outcome: 'reconciliation_required' } as const;
      command = schemas.command.parse({
        operationId: claim.operationId,
        integrationId: claim.integrationId,
        merchantId: claim.merchantId,
        customerId: claim.customerId,
        goalId: claim.goalId,
        treasuryBindingId: claim.treasuryBindingId,
        savedMethodId: claim.savedMethodId,
        eventId,
        collectionReference: data.reference,
        collectionTransactionId: data.id,
        collectionAmountKobo: data.amount,
        currency: data.currency,
        providerStatus: data.status,
        domain: data.domain,
      });
    } catch {
      return { outcome: 'reconciliation_required' } as const;
    }
    return store.recordReversal(command);
  };
}
