import { getMobileAdUnitId } from '@/config/mobile-ad-placements';

/**
 * Whether the REWARDED placement may serve. The global ads kill switch
 * governs every placement: the legacy quiz gate alone must not keep
 * offering rewarded ads while the placement is disabled or unconfigured.
 */
export function isRewardedPlacementEnabled(): boolean {
  try {
    return getMobileAdUnitId('REWARDED').enabled === true;
  } catch {
    return false;
  }
}
