import 'server-only';
import { prefundedCardCheckoutSchemas as schemas } from '@/schemas/prefunded-card-checkout';
import { prefundedCardCheckoutStateSchemas as states } from '@/schemas/prefunded-card-checkout-state';
import type { PrefundedCardCheckoutStore } from './prefunded-card-checkout-store.types';

type Intent = ReturnType<typeof schemas.intent.parse>;
type Selection = ReturnType<typeof schemas.selection.parse>;
type Snapshot = ReturnType<typeof states.snapshot.parse>;

export function createPrefundedCardCheckoutRuntime({
  scope,
  store,
  provider,
  resolveCustomer,
  now = Date.now,
}: {
  scope: unknown;
  store: PrefundedCardCheckoutStore;
  provider: {
    initialize(intent: Intent): Promise<unknown>;
    verify(intent: Intent): Promise<unknown>;
  };
  resolveCustomer: (goalId: string) => Promise<unknown>;
  now?: () => number;
}) {
  const configured = schemas.scope.safeParse(scope);
  if (!configured.success) throw new Error('First-card checkout unavailable');
  const pins = Object.freeze(configured.data);
  const customerFor = async (goalId: string) => {
    const identity = schemas.customerIdentity.parse(
      await resolveCustomer(goalId)
    );
    if (identity.goalId !== goalId)
      throw new Error('First-card checkout unavailable');
    return identity;
  };
  const active = () => {
    const timestamp = now();
    if (!Number.isFinite(timestamp) || timestamp >= Date.parse(pins.expiresAt))
      throw new Error('First-card checkout unavailable');
  };
  const matches = (intent: Intent, selection: Selection) => {
    if (
      Object.keys(pins).some(
        (key) =>
          intent[key as keyof typeof pins] !== pins[key as keyof typeof pins]
      ) ||
      intent.intentId !== selection.intentId ||
      intent.customerId !== selection.customerId ||
      intent.actorId !== selection.actorId ||
      intent.goalId !== selection.goalId
    )
      throw new Error('First-card checkout unavailable');
  };
  const snapshotFor = (
    value: unknown,
    selection: Selection,
    original?: Intent
  ) => {
    const snapshot = states.snapshot.parse(value);
    matches(snapshot.intent, selection);
    if (
      original &&
      JSON.stringify(snapshot.intent) !== JSON.stringify(original)
    )
      throw new Error('First-card checkout unavailable');
    return snapshot;
  };
  const publicState = (snapshot: Snapshot) => ({
    intentId: snapshot.intent.intentId,
    goalId: snapshot.intent.goalId,
    amountKobo: snapshot.intent.amountKobo,
    currency: snapshot.intent.currency,
    status: snapshot.phase,
    ...(snapshot.session
      ? { authorizationUrl: snapshot.session.authorizationUrl }
      : {}),
  });
  const pending = (intent: Intent) =>
    publicState({
      intent,
      phase: 'pending',
      session: null,
      operationId: null,
    });
  active();

  return {
    async start(input: unknown) {
      try {
        active();
        const body = schemas.customerRequest.parse(input);
        const request = schemas.request.parse({
          ...body,
          ...(await customerFor(body.goalId)),
        });
        active();
        const reserved = states.snapshot.parse(
          await store.reserve(pins, request)
        );
        const selection = schemas.selection.parse({
          intentId: reserved.intent.intentId,
          customerId: request.customerId,
          actorId: request.actorId,
          goalId: request.goalId,
        });
        matches(reserved.intent, selection);
        if (
          reserved.intent.amountKobo !== request.amountKobo ||
          reserved.intent.idempotencyKey !== request.idempotencyKey ||
          JSON.stringify(reserved.intent.consent) !==
            JSON.stringify(request.consent)
        )
          throw new Error('First-card checkout unavailable');
        active();
        if (reserved.phase !== 'reserved') return publicState(reserved);
        const claim = states.initialization.parse(
          await store.claimInitialization(pins, selection)
        );
        if (claim.outcome === 'existing')
          return publicState(
            snapshotFor(claim.snapshot, selection, reserved.intent)
          );
        matches(claim.intent, selection);
        if (JSON.stringify(claim.intent) !== JSON.stringify(reserved.intent))
          throw new Error('First-card checkout unavailable');
        try {
          active();
          if (
            Date.parse(claim.leaseExpiresAt) <= now() ||
            Date.parse(claim.leaseExpiresAt) > Date.parse(pins.expiresAt)
          )
            throw new Error('First-card checkout unavailable');
          const session = schemas.session.parse(
            await provider.initialize(claim.intent)
          );
          if (session.reference !== claim.intent.reference)
            throw new Error('First-card checkout unavailable');
          active();
          if (Date.parse(claim.leaseExpiresAt) <= now())
            throw new Error('First-card checkout unavailable');
          const recorded = snapshotFor(
            await store.completeInitialization(pins, selection, claim, session),
            selection,
            claim.intent
          );
          if (
            recorded.phase !== 'ready' ||
            JSON.stringify(recorded.session) !== JSON.stringify(session)
          )
            throw new Error('First-card checkout unavailable');
          return publicState(recorded);
        } catch {
          await store.markInitializationUncertain(pins, selection, claim);
          active();
          return pending(claim.intent);
        }
      } catch {
        throw new Error('First-card checkout unavailable');
      }
    },
    async refresh(input: unknown) {
      try {
        active();
        const body = schemas.customerSelection.parse(input);
        const selection = schemas.selection.parse({
          ...body,
          ...(await customerFor(body.goalId)),
        });
        active();
        const current = snapshotFor(
          await store.read(pins, selection),
          selection
        );
        active();
        if (!['initializing', 'ready', 'pending'].includes(current.phase))
          return publicState(current);
        let verification: ReturnType<typeof states.verification.parse>;
        try {
          verification = states.verification.parse(
            await provider.verify(current.intent)
          );
        } catch {
          return pending(current.intent);
        }
        active();
        if (verification.outcome === 'pending') return pending(current.intent);
        if (verification.outcome === 'reconciliation_required') {
          await store.flagReconciliation(pins, selection);
          return publicState({
            ...current,
            phase: 'reconciliation_required',
            session: null,
          });
        }
        const collection = verification.collection;
        if (
          collection.intentId !== current.intent.intentId ||
          collection.reference !== current.intent.reference ||
          collection.amountKobo !== current.intent.amountKobo ||
          collection.currency !== current.intent.currency ||
          collection.authorization.email !== current.intent.email
        )
          throw new Error('First-card checkout unavailable');
        const promoted = snapshotFor(
          await store.promoteVerifiedCollection(pins, selection, collection),
          selection,
          current.intent
        );
        if (
          !['funding_pending', 'completed', 'reconciliation_required'].includes(
            promoted.phase
          )
        )
          throw new Error('First-card checkout unavailable');
        return publicState(promoted);
      } catch {
        throw new Error('First-card checkout unavailable');
      }
    },
  };
}
