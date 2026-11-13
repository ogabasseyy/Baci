import { create } from 'zustand';
import {
  acquireUtilityCheckoutOrAlert,
  releaseUtilityCheckout,
} from '@/lib/utility-checkout-inflight';
import { creditedVtuCashback } from '@/lib/vtu-checkout-helpers';
import type { VtuWalletPayRequest } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import type { VtuWalletPayResult } from './vtu-wallet-pay-adapter';

export type VtuWalletPayPending = {
  request: VtuWalletPayRequest;
  onDelivered: (result: VtuWalletPayResult) => void;
};

type State = {
  /** Set by the screen's host: whether the PiggyVest wallet pays this. */
  covers: (amount: number) => boolean;
  /** The PiggyVest wallet balance shown when it pays (null = not offered). */
  balanceKobo: number | null;
  /**
   * Whether an earlier PiggyVest attempt for this purchase is retained (its
   * answer was lost). Such a purchase replays on PiggyVest whatever the
   * balances say now, never on a second rail. A failed read counts as
   * retained (the sheet then asks to try again).
   */
  retains: (request: VtuWalletPayRequest) => Promise<boolean>;
  pending: VtuWalletPayPending | null;
};

/**
 * Hands a purchase from the airtime, data or bill form to the one PiggyVest
 * pay sheet on the utilities screen (VtuWalletPayHost). Until a host says
 * otherwise nothing is covered, so the forms keep their store credit flow.
 */
export const useVtuWalletPayStore = create<State>(() => ({
  covers: () => false,
  balanceKobo: null,
  retains: async () => false,
  pending: null,
}));

/**
 * Opens the PiggyVest pay sheet for this purchase when the PiggyVest wallet
 * covers it (and no other is open). False = carry on with store credit.
 * It holds the screen-wide utility checkout slot until the sheet closes, so
 * no sibling tab starts another purchase meanwhile (and none is running).
 */
export function openVtuWalletPay(
  request: VtuWalletPayRequest,
  onDelivered: (result: VtuWalletPayResult) => void,
  /** A retained PiggyVest attempt: replay it whatever covers() says. */
  replay = false
): boolean {
  const state = useVtuWalletPayStore.getState();
  if (state.pending || !(replay || state.covers(request.amount))) return false;
  // Another checkout is running: refused with its alert (true = handled).
  if (!acquireUtilityCheckoutOrAlert()) return true;
  useVtuWalletPayStore.setState({ pending: { request, onDelivered } });
  return true;
}

export function clearVtuWalletPay() {
  if (useVtuWalletPayStore.getState().pending) releaseUtilityCheckout();
  useVtuWalletPayStore.setState({ pending: null });
}

export type VtuPiggyvestSuccess = {
  amount: number;
  customerIdentifier: string;
  reference: string;
  status: 'successful';
  voucherPin?: string;
  address?: string;
  cashback?: { amount: number; credited: boolean; newBalance: number };
};

/**
 * A form's hand-over: pays this purchase from the PiggyVest wallet when it
 * covers it (and no store credit attempt for it is retained), reporting
 * success the way the form's store credit path does.
 * False = carry on with store credit, exactly as before.
 */
export async function payFromPiggyvest(
  request: VtuWalletPayRequest & { customerAddress?: string },
  onSuccess: (result: VtuPiggyvestSuccess) => void,
  customerIdentifier: string,
  /** The form's retained-replay peek, taken once before this call. */
  isRetainedReplay: boolean
): Promise<boolean> {
  // A store credit attempt that was charged but never answered must replay
  // on its own key, never be forked into a second (PiggyVest) purchase.
  if (isRetainedReplay) return false;
  // Likewise a retained PiggyVest attempt replays on PiggyVest, even when
  // store credit would now cover it (Codex P1).
  const replay = await useVtuWalletPayStore
    .getState()
    .retains(request)
    .catch(() => true);
  return openVtuWalletPay(
    request,
    (result) =>
      onSuccess({
        // The server's amount; a replay without one bought this same request
        // (the amount is part of its fingerprint).
        amount: result.amount ?? request.amount,
        customerIdentifier,
        reference: result.reference,
        status: 'successful',
        ...(result.voucherPin ? { voucherPin: result.voucherPin } : {}),
        // Only a credited cashback, as the store credit path shows it.
        ...(creditedVtuCashback(result.cashback)
          ? { cashback: creditedVtuCashback(result.cashback) }
          : {}),
        ...(request.customerAddress
          ? { address: request.customerAddress }
          : {}),
      }),
    replay
  );
}
