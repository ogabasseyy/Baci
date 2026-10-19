import { createPrefundedCardCheckoutProvider } from '../../../../apps/web/src/lib/piggyvest/prefunded-card-checkout-provider';
import { prefundedCardCheckoutSchemas as schemas } from '../../../../apps/web/src/schemas/prefunded-card-checkout';

type Intent = ReturnType<typeof schemas.intent.parse>;

export async function collectFirstCardOwnerProof({
  settings,
  intent: input,
  expectedIntent,
  fetchImplementation,
  now = Date.now,
}: {
  settings: unknown;
  intent: unknown;
  expectedIntent: Intent;
  fetchImplementation: typeof fetch;
  now?: () => number;
}) {
  const intent = schemas.intent.parse(input);
  const expected = schemas.intent.parse(expectedIntent);
  if (JSON.stringify(intent) !== JSON.stringify(expected))
    throw new Error('Owner payment intent differs');
  const beganAt = now();
  const provider = createPrefundedCardCheckoutProvider({
    settings,
    fetchImplementation,
    now,
  });
  const verified = await provider.verify(intent);
  const verifiedAt = now();
  if (
    !Number.isFinite(beganAt) ||
    !Number.isFinite(verifiedAt) ||
    verifiedAt < beganAt ||
    verifiedAt - beganAt > 10_000 ||
    verifiedAt >= Date.parse(intent.expiresAt) ||
    verified.outcome !== 'verified'
  )
    throw new Error('Owner payment verification unavailable');
  const collection = schemas.collection.parse(verified.collection);
  if (
    collection.intentId !== intent.intentId ||
    collection.reference !== intent.reference ||
    collection.amountKobo !== intent.amountKobo ||
    collection.currency !== intent.currency ||
    collection.authorization.email !== intent.email
  )
    throw new Error('Owner payment collection differs');
  return {
    kind: 'independently-verified-test-collection' as const,
    verifiedAt: new Date(verifiedAt).toISOString(),
    intent,
    collection,
    newPaymentStarted: false as const,
  };
}
