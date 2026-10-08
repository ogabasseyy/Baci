import 'server-only';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';
import type { createPrimaryWalletCardCheckoutExecutor } from './primary-wallet-card-checkout-executor';
import type { createPrimaryWalletCardCheckoutProvider } from './primary-wallet-card-checkout-provider';

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
    if (
      Object.entries(scope).some(
        ([key, value]) => intent[key as keyof typeof scope] !== value
      )
    )
      throw new Error('Primary card identity unavailable');
    return intent;
  };
  const publicState = (intent: ReturnType<typeof select>) => ({
    operationId: intent.operationId,
    reference: intent.reference,
    amountKobo: intent.amountKobo,
    currency: 'NGN' as const,
    status: intent.status,
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
      if (
        intent.amountKobo !== request.amountKobo ||
        JSON.stringify(intent.consent) !== JSON.stringify(request.consent)
      )
        throw new Error('Primary card reservation unavailable');
      active();
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
        active();
        session = schemas.session.parse(
          await input.provider.initialize(claim.intent)
        );
        if (session.reference !== intent.reference) session = null;
      } catch {
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
      active();
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
      const verification = await input.provider.verify(intent);
      active();
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
