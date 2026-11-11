import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { toOxygenMinorUnits } from './money';

export function bookedPlanIsOffered(s: OxygenProviderState): boolean {
  const booking = s.booking;
  const offer = s.offers?.find((item) => item.tenure === booking?.loan_tenure);
  if (
    !booking ||
    !offer ||
    s.eligibleAmount === undefined ||
    s.minimumAmount === undefined ||
    s.maxTenure === undefined ||
    booking.loan_tenure > s.maxTenure
  )
    return false;
  try {
    const principal = toOxygenMinorUnits(booking.loan_amount, 'NGN');
    const offerLimit = toOxygenMinorUnits(offer.loanAmount, 'NGN');
    const overallLimit = toOxygenMinorUnits(s.eligibleAmount, 'NGN');
    return (
      principal >= toOxygenMinorUnits(s.minimumAmount, 'NGN') &&
      principal <= Math.min(offerLimit, overallLimit)
    );
  } catch {
    return false;
  }
}
