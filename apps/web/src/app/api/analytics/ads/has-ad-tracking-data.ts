import { TRANSACTION_DISCOUNT_METADATA_KEY } from '@baci/shared/contracts';
import type { AdTrackingData } from '@/lib/ad-tracking-cookies';

export function hasAdTrackingData(value: unknown): value is AdTrackingData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value).some(
    (key) => key !== TRANSACTION_DISCOUNT_METADATA_KEY
  );
}
