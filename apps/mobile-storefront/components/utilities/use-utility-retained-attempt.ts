import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { VtuWalletPayRequest } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { useRetainsPiggyvest } from './use-retains-piggyvest';

/**
 * Whether this exact purchase has a kept attempt (store credit or PiggyVest)
 * whose answer was lost. The next submit replays it without a new charge, so
 * a short balance must not block Pay for it.
 */
export function useUtilityRetainedAttempt(
  payment: Pick<ReturnType<typeof useUtilityPayment>, 'hasRetainedVtuAttempt'>,
  request: VtuWalletPayRequest | null
): boolean {
  const retainedStoreCredit =
    request !== null &&
    payment.hasRetainedVtuAttempt?.({ ...request }) === true;
  const retainedPiggyvest = useRetainsPiggyvest(request);
  return retainedStoreCredit || retainedPiggyvest;
}
