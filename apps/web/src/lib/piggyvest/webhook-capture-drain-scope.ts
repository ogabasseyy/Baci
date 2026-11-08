import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { primaryOwnerFamily } from './primary-event-owner';
import type { PiggyvestWebhookKeyFamily } from './webhook-secret-union';

/**
 * What the worker-host capture drain may replay (R5).
 *
 * The drain runs under its own database login and holds no service-role
 * authority. Primary deliveries use their dedicated logins. Legacy-family
 * deliveries stay out of scope unless the separately configured legacy lane
 * is enabled; that lane uses the existing restricted webhook-intake login.
 */

/** True when the event's owning primary intake family signed it. */
function ownerRecorded(
  families: readonly PiggyvestWebhookKeyFamily[],
  eventType: string | null
): boolean {
  const owner = primaryOwnerFamily(eventType ?? '');
  return owner !== undefined && families.includes(owner);
}

/**
 * Pre-verification scope check on a claimed row. A row its owning primary
 * family signed goes to that primary intake. Legacy rows pass this check
 * only when the explicit legacy lane is enabled. Other rows proceed so the
 * drain can judge them after exact signature verification.
 */
export function workerHostReplayScope(
  row: Pick<PiggyvestClaimedCapture, 'key_families' | 'event_type'>,
  legacyReplayEnabled = false
): string | null {
  if (ownerRecorded(row.key_families, row.event_type)) return null;
  return row.key_families.includes('legacy') && !legacyReplayEnabled
    ? 'LEGACY_FAMILY'
    : null;
}
