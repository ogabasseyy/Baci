import { createHash } from 'node:crypto';
import type { OxygenEnvironment } from './environment';

/**
 * One lock per environment and partner reference. The checkout refresh and the
 * scheduled bank recovery job both claim it, so only one of them calls the
 * provider's bank list at a time. The partner reference is hashed, never stored.
 */
export function bankRefreshLockKey(
  environment: OxygenEnvironment,
  partner: string
) {
  const digest = createHash('sha256').update(partner).digest('hex');
  return `oxygen:supported-banks-recovery:${environment}:${digest}`;
}
