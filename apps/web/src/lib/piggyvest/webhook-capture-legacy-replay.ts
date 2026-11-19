import 'server-only';
import {
  isAuthorizationQuarantine,
  isConflictQuarantine,
  isContentQuarantine,
  isKeySetIncompleteRetry,
  isKillSwitchDeferred,
  processVerifiedDelivery,
} from '@/app/api/webhooks/piggyvest/process-delivery';
import type { PiggyvestClientConfig } from '@/lib/piggyvest/client';
import { authorizesLegacyHandling } from './primary-event-owner';
import { createPiggyvestIntakeClient } from './server-intake-client';
import type {
  ReplayDelivery,
  ReplayProcessResult,
} from './webhook-capture-drain';
import { parseStoredPiggyvestEvent } from './webhook-capture-stored-event';

/** The opt-in adapter reuses the receiver's existing restricted intake graph. */
export async function replayLegacyDelivery(
  delivery: ReplayDelivery,
  env: NodeJS.ProcessEnv = process.env,
  deps: {
    createClient?: () => ReturnType<typeof createPiggyvestIntakeClient>;
    getConfig?: () => PiggyvestClientConfig | null;
  } = {}
): Promise<ReplayProcessResult> {
  // Replay authority is the immutable intersection established by drain.ts.
  // Incomplete verification can never authorize the legacy handler.
  if (delivery.incompleteKeySet === true)
    return { status: 503, keySetIncomplete: true };
  const event = parseStoredPiggyvestEvent(delivery.rawBody);
  if (
    !event ||
    !authorizesLegacyHandling(event.eventType, delivery.families) ||
    !authorizesLegacyHandling(event.eventType, delivery.recordedFamilies)
  )
    return { status: 200, authorizationQuarantine: true };

  let client: ReturnType<typeof createPiggyvestIntakeClient> | undefined;
  const lazyClient = () =>
    (client ??= (
      deps.createClient ?? (() => createPiggyvestIntakeClient(env))
    )());
  const getConfig =
    deps.getConfig ??
    (() => {
      const token =
        env.PIGGYVEST_SECRET_KEY?.trim() || env.PVB_SECRET_KEY?.trim();
      if (!token) return null;
      const baseUrl = env.PIGGYVEST_API_BASE_URL?.trim();
      return baseUrl ? { token, baseUrl } : { token };
    });
  try {
    const response = await processVerifiedDelivery(
      {
        rawBody: delivery.rawBody,
        signature: delivery.signature,
        matchedSecret: delivery.matchedSecret,
        families: delivery.families,
        incompleteKeySet: false,
        keyScope: 'replay',
      },
      { createClient: lazyClient, getPiggyvestConfig: getConfig, env }
    );
    return {
      status: response.status,
      ...(isContentQuarantine(response) ? { contentQuarantine: true } : {}),
      ...(isAuthorizationQuarantine(response)
        ? { authorizationQuarantine: true }
        : {}),
      ...(isKeySetIncompleteRetry(response) ? { keySetIncomplete: true } : {}),
      ...(isKillSwitchDeferred(response) ? { killSwitchDeferred: true } : {}),
      ...(isConflictQuarantine(response) ? { conflict: true } : {}),
    };
  } finally {
    try {
      await client?.dispose?.();
    } catch {
      // Disposal failure must not change a completed replay outcome.
    }
  }
}
