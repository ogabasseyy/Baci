import { isPiggyvestPrimaryMerchant } from './is-piggyvest-primary-merchant';

/**
 * A PiggyVest merchant whose primary wallet the server hasn't ruled out
 * (capability true or still unknown). Purchase top-ups there are card-only
 * store credit, even when this customer's PiggyVest read is unknown or not
 * set up yet: a bank transfer would fund savings, not the purchase.
 */
export function isPiggyvestCardOnlyMerchant(
  merchantId: string | null | undefined,
  capability: boolean | null
): boolean {
  return (
    !!merchantId &&
    isPiggyvestPrimaryMerchant(merchantId) &&
    capability !== false
  );
}
