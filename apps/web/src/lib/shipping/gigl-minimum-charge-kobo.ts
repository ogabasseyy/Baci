import { GIGL_PLATFORM_MARGIN_BPS } from './gigl-pricing-constants';

/** Cost plus the 10% margin floor, ceiled to the kobo. */
export function minimumChargeKobo(providerCostKobo: number): number {
  return Math.ceil(
    (providerCostKobo * (10_000 + GIGL_PLATFORM_MARGIN_BPS)) / 10_000
  );
}
