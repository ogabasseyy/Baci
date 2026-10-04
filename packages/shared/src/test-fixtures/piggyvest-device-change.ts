import { piggyvestDeviceChangeSchemas as schemas } from '../contracts/piggyvest-device-change';
import { purchaseFixture } from './piggyvest-purchase';
export function deviceChangeFixture() {
  const prior = purchaseFixture();
  const quote = schemas.quote.parse({
    quoteId: prior.operationId,
    revisionId: prior.goalId,
    priorRevisionId: prior.source.policy.revisionId,
    goalId: prior.goalId,
    device: {
      productId: prior.operationId,
      variantId: null,
      productName: 'Synthetic replacement',
      variant: null,
      condition: 'new',
    },
    priceKobo: 105050,
    durationMonths: 1,
    termsVersion: 'synthetic-change',
    termsHash: 'b'.repeat(64),
    maturesAt: '2099-01-01T00:00:00Z',
    graceExpiresAt: '2099-01-31T00:00:00Z',
    expiresAt: '2098-01-01T00:00:00Z',
  });
  const { expiresAt: _expiry, ...saved } = quote;
  const receipt = schemas.receipt.parse({
    ...saved,
    operationId: prior.operationId,
    status: 'device_changed',
    wallet: 'unchanged',
    balances: 'unchanged',
    collection: 'paused',
    dispatch: 'disabled',
  });
  return {
    source: prior.source,
    selection: {
      goalId: quote.goalId,
      quoteId: quote.quoteId,
      productId: quote.device.productId,
      variantId: quote.device.variantId,
    },
    published: schemas.published.parse({
      status: 'quote_available',
      quote,
      terms: {
        version: quote.termsVersion,
        hash: quote.termsHash,
        text: 'Synthetic changed terms',
      },
    }),
    command: schemas.confirmation.parse({
      goalId: quote.goalId,
      operationId: prior.operationId,
      accepted: true,
      quote,
    }),
    receipt,
    historical: schemas.historical.parse({ status: 'historical', receipt }),
  };
}
