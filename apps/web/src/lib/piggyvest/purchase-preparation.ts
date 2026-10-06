import 'server-only';
import { purchasePreparationSchemas as schemas } from '@/schemas/purchase-preparation';
import { PURCHASE_PREPARATION_STATEMENTS as statements } from './purchase-preparation-statements';

export function createPurchasePreparation(options: {
  configuration: unknown;
  execute: (
    statement: string,
    parameters: readonly string[]
  ) => Promise<{ rows: unknown }>;
}) {
  const config = schemas.configuration.parse(options.configuration);
  const scope = [
    config.integrationId,
    config.merchantId,
    config.customerId,
    config.goalId,
    config.expectedBusinessId,
  ];
  return {
    async quote(input: unknown) {
      try {
        const { quoteId } = schemas.selection.parse(input);
        const response = await options.execute(statements.purchaseQuote.text, [
          ...scope,
          config.actorId,
          quoteId,
        ]);
        const quote = schemas.rows.parse(response.rows)[0].result;
        if (quote.quoteId !== quoteId) throw new Error('Quote mismatch');
        return quote;
      } catch {
        return { status: 'unavailable' } as const;
      }
    },
    async prepare(input: unknown) {
      try {
        const { operationId, accepted, quote } =
          schemas.confirmation.parse(input);
        const response = await options.execute(
          statements.purchasePrepare.text,
          [
            ...scope,
            JSON.stringify({
              operationId,
              actorId: config.actorId,
              accepted,
              quote,
            }),
          ]
        );
        const receipt = schemas.receipts.parse(response.rows)[0].result;
        if (
          receipt.operationId !== operationId ||
          receipt.quoteId !== quote.quoteId ||
          receipt.savingsKobo !== quote.savingsKobo ||
          receipt.otherPaymentKobo !== quote.otherPaymentKobo ||
          receipt.principalKobo !== quote.principalKobo ||
          receipt.paidInterestKobo !== quote.paidInterestKobo ||
          receipt.surplusKobo !== quote.surplusKobo
        )
          throw new Error('Receipt mismatch');
        return receipt;
      } catch {
        return {
          status: 'unavailable',
          reservation: 'may_be_retained',
          dispatch: 'contract_gap',
        } as const;
      }
    },
    async status(input: unknown) {
      try {
        const { operationId } = schemas.operation.parse(input);
        const response = await options.execute(statements.purchaseStatus.text, [
          ...scope,
          config.actorId,
          operationId,
        ]);
        const receipt = schemas.receipts.parse(response.rows)[0].result;
        if (receipt.operationId !== operationId)
          throw new Error('Receipt mismatch');
        return receipt;
      } catch {
        return {
          status: 'unavailable',
          reservation: 'may_be_retained',
          dispatch: 'contract_gap',
        } as const;
      }
    },
  };
}
