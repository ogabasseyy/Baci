import 'server-only';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';
import type { createPrimaryWalletCardCheckoutExecutor } from './primary-wallet-card-checkout-executor';
import { assertCheckoutIntentOwnership } from './primary-wallet-card-checkout-ownership';
import {
  type createPrimaryWalletCardCheckoutProvider,
  isPrimaryCardDuplicateReference,
} from './primary-wallet-card-checkout-provider';

export function createPrimaryWalletCardCheckoutService(input: {
  settings: unknown;
  scope: unknown;
  execute: ReturnType<typeof createPrimaryWalletCardCheckoutExecutor>;
  provider: ReturnType<typeof createPrimaryWalletCardCheckoutProvider>;
  now?: () => number;
}) {
  const settings = schemas.settings.parse(input.settings);
  const scope = schemas.scope.parse(input.scope);
  if (
    scope.environment !== settings.environment ||
    scope.integrationId !== settings.integrationId ||
    scope.merchantId !== settings.merchantId ||
    scope.businessId !== settings.businessId
  )
    throw new Error('Primary card scope unavailable');
  const storageScope = JSON.stringify({
    ...scope,
    expiresAt: settings.expiresAt,
    callbackUrl: settings.callbackUrl,
  });
  // The deadline blocks NEW reservations only. Status polling,
  // initialization re-entry, and webhook reconciliation must keep draining
  // operations created before expiry — otherwise a customer who pays (or
  // whose webhook lands) after the deadline stays charged-but-uncredited.
  // Those paths deliberately never call active().
  const active = () => {
    const timestamp = (input.now ?? Date.now)();
    if (
      !Number.isFinite(timestamp) ||
      timestamp >= Date.parse(settings.expiresAt)
    )
      throw new Error('Primary card checkout unavailable');
  };
  const select = (value: unknown) => {
    const intent = schemas.intent.parse(value);
    assertCheckoutIntentOwnership(scope, intent);
    return intent;
  };
  const publicState = (intent: ReturnType<typeof select>) => ({
    operationId: intent.operationId,
    reference: intent.reference,
    amountKobo: intent.amountKobo,
    currency: 'NGN' as const,
    status: intent.status,
    // Echo the stored save-card choice: adoption resumes a stored checkout
    // whose consent may differ from the just-entered one, and the client
    // must confirm a consent change before any payment. Only saveCard
    // varies (version/oneTimeCharge are literals).
    saveCard: intent.consent.saveCard,
    ...(intent.status === 'ready' && intent.authorizationUrl
      ? { authorizationUrl: intent.authorizationUrl }
      : {}),
  });
  const read = async (operationId: string) => {
    const intent = select(
      await input.execute('read', [storageScope, operationId])
    );
    if (intent.operationId !== operationId)
      throw new Error('Primary card identity unavailable');
    return intent;
  };
  // Re-runs the initialization sequence for a stale uninitialized claim.
  // Returns null when the lease is still held so status polling continues;
  // otherwise the caller's stale verdict is replaced by a fresh one.
  const reenterInitialization = async (operationId: string) => {
    const claim = schemas.claim.parse(
      await input.execute('claim', [storageScope, operationId])
    );
    if (claim.outcome !== 'claimed') return null;
    const reclaimed = select(claim.intent);
    if (reclaimed.operationId !== operationId)
      throw new Error('Primary card identity unavailable');
    let session: ReturnType<typeof schemas.session.parse> | null = null;
    try {
      session = schemas.session.parse(
        await input.provider.initialize(reclaimed)
      );
      if (session.reference !== reclaimed.reference) session = null;
    } catch (error) {
      // A duplicate reference proves Paystack holds a session under our
      // reference, but no checkout URL was ever recorded or delivered
      // (only 'ready' exposes one), so no customer can pay it. Abandon
      // the orphaned operation — releasing treasury — so the customer
      // starts fresh instead of polling a dead reference forever. Any
      // other failure stays ambiguous and records init_unknown below.
      if (isPrimaryCardDuplicateReference(error)) {
        schemas.acknowledgement.parse(
          await input.execute('abandonment', [storageScope, operationId])
        );
        return publicState(await read(operationId));
      }
      session = null;
    }
    schemas.initializationAcknowledgement.parse(
      await input.execute('initialize', [
        storageScope,
        operationId,
        claim.token,
        session ? JSON.stringify(session) : null,
      ])
    );
    return publicState(await read(operationId));
  };
  return {
    async initialize(body: unknown) {
      active();
      const request = schemas.request.parse(body);
      if (request.merchantId !== scope.merchantId)
        throw new Error('Primary card identity unavailable');
      const { merchantId: _merchantId, ...storedRequest } = request;
      const intent = select(
        await input.execute('reserve', [
          storageScope,
          JSON.stringify(storedRequest),
        ])
      );
      // Adopt the stored intent when reserve-recovery returns the
      // customer's unresolved operation for a different amount or consent
      // (lost device storage with a re-entered amount). Throwing here
      // strands a possibly charged checkout: the client never learns the
      // stored operation ID, so every retry fails identically. The stored
      // intent is authoritative — same user, same one-unresolved-operation
      // slot — so initialization proceeds on it and the response carries
      // the stored amount and operation ID for the client to persist and
      // resume. The client must confirm the adopted amount before payment.
      // No deadline re-check from here on: the reservation is committed,
      // and failing now would strand it (treasury held, client without
      // the operation ID, re-initialization disabled past expiry). The
      // deadline gates reservation only; a reserved checkout always
      // resolves through claim/initialize like any other drain.
      const claim = schemas.claim.parse(
        await input.execute('claim', [storageScope, intent.operationId])
      );
      if (
        JSON.stringify(select(claim.intent)) !==
        JSON.stringify({ ...intent, status: claim.intent.status })
      )
        throw new Error('Primary card claim unavailable');
      if (claim.outcome === 'existing') return publicState(claim.intent);
      let session: ReturnType<typeof schemas.session.parse> | null = null;
      try {
        session = schemas.session.parse(
          await input.provider.initialize(claim.intent)
        );
        if (session.reference !== intent.reference) session = null;
      } catch (error) {
        // Same orphan rule as status re-entry: the claim above proves we
        // hold the lease, so a duplicate reference means a session exists
        // whose checkout URL was never recorded or delivered. Abandon
        // rather than pinning the retry to init_unknown.
        if (isPrimaryCardDuplicateReference(error)) {
          schemas.acknowledgement.parse(
            await input.execute('abandonment', [
              storageScope,
              intent.operationId,
            ])
          );
          return publicState(await read(intent.operationId));
        }
        session = null;
      }
      schemas.initializationAcknowledgement.parse(
        await input.execute('initialize', [
          storageScope,
          intent.operationId,
          claim.token,
          session ? JSON.stringify(session) : null,
        ])
      );
      return publicState(await read(intent.operationId));
    },
    async status(operationId: string) {
      const intent = await read(
        schemas.statusRequest.shape.operationId.parse(operationId)
      );
      if (
        [
          'reserved',
          'custody_pending',
          'reconciliation_required',
          'completed',
          'abandoned',
        ].includes(intent.status)
      )
        return publicState(intent);
      // A claim whose holder died before recording strands status polling:
      // the provider reference may never have been created, yet status
      // only verifies it. Re-enter initialization once the claim lease
      // expires (claim returns 'claimed'); a live holder yields
      // 'existing' and polling continues below.
      if (
        intent.status === 'initializing' ||
        intent.status === 'init_unknown'
      ) {
        const reentered = await reenterInitialization(operationId);
        if (reentered) return reentered;
      }
      const verification = await input.provider.verify(intent);
      if (verification.outcome === 'pending') return publicState(intent);
      if (verification.outcome === 'abandoned')
        schemas.acknowledgement.parse(
          await input.execute('abandonment', [storageScope, operationId])
        );
      else if (verification.outcome === 'reconciliation_required')
        schemas.initializationAcknowledgement.parse(
          await input.execute('reconciliation', [storageScope, operationId])
        );
      else
        schemas.acknowledgement.parse(
          await input.execute('collection', [
            storageScope,
            operationId,
            JSON.stringify(verification.collection),
          ])
        );
      return publicState(await read(operationId));
    },
  };
}
