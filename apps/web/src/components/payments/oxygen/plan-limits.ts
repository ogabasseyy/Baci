import { toOxygenMinorUnits } from '@/lib/payments/oxygen/money';

type PlanLimits =
  | { kind: 'available'; min: number; max: number }
  | { kind: 'unavailable' }
  | { kind: 'unknown' };

/** Match the booking endpoint's percentage precision and kobo rounding. */
export function oxygenPlanLimits(
  productAmount: number | undefined,
  eligibleAmount: number | undefined,
  minimumAmount: number | undefined
): PlanLimits {
  if (
    productAmount === undefined ||
    eligibleAmount === undefined ||
    minimumAmount === undefined
  )
    return { kind: 'unknown' };
  try {
    const total = BigInt(toOxygenMinorUnits(productAmount, 'NGN'));
    const eligible = BigInt(toOxygenMinorUnits(eligibleAmount, 'NGN'));
    const minimum = BigInt(toOxygenMinorUnits(minimumAmount, 'NGN'));
    if (total <= 0n || eligible <= 0n || minimum <= 0n)
      return { kind: 'unknown' };
    const principal = (basisPoints: number) =>
      total - (total * BigInt(basisPoints) + 5000n) / 10000n;
    // Find the first 0.01% step satisfying a monotonic predicate.
    const first = (predicate: (basisPoints: number) => boolean) => {
      let low = 2500;
      let high = 9001;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (predicate(middle)) high = middle;
        else low = middle + 1;
      }
      return low;
    };
    const min = first((basisPoints) => principal(basisPoints) <= eligible);
    const max = first((basisPoints) => principal(basisPoints) < minimum) - 1;
    if (min > max || min > 9000 || max < 2500) return { kind: 'unavailable' };
    return { kind: 'available', min: min / 100, max: max / 100 };
  } catch {
    return { kind: 'unknown' };
  }
}
