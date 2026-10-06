import { piggyvestProtectedOfferSchemas as schemas } from '../contracts/piggyvest-protected-offer';
import { purchaseFixture } from '../test-fixtures/piggyvest-purchase';

export function protectedOfferFixture() {
  const purchase = purchaseFixture();
  const receipt = schemas.receipt.parse({
    offerId: purchase.operationId,
    goalId: purchase.goalId,
    revisionId: purchase.source.policy.revisionId,
    device: {
      productId: purchase.operationId,
      variantId: purchase.operationId,
      condition: purchase.source.policy.device.condition,
    },
    priceKobo: 97000,
    termsVersion: purchase.source.policy.terms.version,
    termsHash: purchase.source.policy.terms.hash,
    startsAt: '2026-09-12T12:00:00Z',
    expiresAt: '2026-09-19T12:00:00Z',
    scope: 'device_price_only',
    purchase: 'requires_confirmation',
    dispatch: 'disabled',
  });
  return {
    source: purchase.source,
    receipt,
    published: schemas.published.parse({ status: 'published', receipt }),
    observation: schemas.observation.parse({
      status: 'observed',
      requestedOfferId: receipt.offerId,
      receipt,
      observedAt: '2026-09-12T13:00:00Z',
      pricePromise: 'active',
      funds: 'requires_checkout_review',
    }),
  };
}
