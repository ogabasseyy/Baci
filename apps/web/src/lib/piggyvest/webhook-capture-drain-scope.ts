import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { primaryOwnerFamily } from './primary-event-owner';
import type { PiggyvestWebhookKeyFamily } from './webhook-secret-union';

/**
 * What the worker-host capture drain may replay (R5).
 *
 * The drain runs on the worker host under its own database login and holds
 * no service-role authority, so it can complete only the deliveries a
 * primary intake owns: each primary intake writes through its own
 * dedicated login. Everything the receiver would hand to the legacy path
 * (legacy-signed deliveries, record-only events, quarantine writes) needs
 * the service role, so the drain defers it with an alert and leaves it to
 * the receiver's own retry path (provider redelivery).
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
 * Pre-verification scope check on a claimed row. A row only the legacy
 * family authorizes (the legacy family is recorded and the event's owning
 * primary family is not) is never replayed here. A row its owning primary
 * family also signed goes to that primary intake, exactly as the receiver
 * routes it inline. Any other row proceeds, so the drain can still judge it
 * (for example park a wrong-family delivery for review).
 */
export function workerHostReplayScope(
  row: Pick<PiggyvestClaimedCapture, 'key_families' | 'event_type'>
): string | null {
  if (ownerRecorded(row.key_families, row.event_type)) return null;
  return row.key_families.includes('legacy') ? 'LEGACY_FAMILY' : null;
}
