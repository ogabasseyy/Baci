import 'server-only';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';
import type { createPrimaryWalletCardCheckoutExecutor } from './primary-wallet-card-checkout-executor';
import { assertCheckoutIntentOwnership } from './primary-wallet-card-checkout-ownership';
import type { createPrimaryWalletCardCheckoutProvider } from './primary-wallet-card-checkout-provider';

/**
 * Status-only drain for card checkouts created before card top-up into
 * the primary wallet was retired. There is no initialization entry point:
 * nothing here reserves, claims or records an initialization, and nothing
 * creates a hosted Paystack checkout (the provider is narrowed to verify).
 * Existing operations still resolve: status reads the stored operation,
 * verifies its reference with Paystack and records the provider-confirmed
 * outcome (collection, abandonment or reconciliation) through evidence
 * storage, before and after the integration deadline.
 */
export function createPrimaryWalletCardCheckoutService(input: {
  settings: unknown;
  scope: unknown;
  execute: ReturnType<typeof createPrimaryWalletCardCheckoutExecutor>;
  provider: Pick<
    ReturnType<typeof createPrimaryWalletCardCheckoutProvider>,
    'verify'
  >;
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
    // Echo the stored save-card choice so a client resuming a stored
    // checkout shows the consent it was created with. Only saveCard
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
  return {
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
      // 'ready', 'initializing' and 'init_unknown' drain by verifying the
      // stored reference only. A stale 'initializing'/'init_unknown'
      // claim is never re-initialized: a reference Paystack never created
      // reads as pending (or reconciliation) and stays for an operator,
      // while a reference that was created and paid still collects.
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
