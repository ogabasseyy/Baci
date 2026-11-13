import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { isPiggyvestFeatureOn } from '@/lib/piggyvest/piggyvest-feature-on';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import {
  readWalletPayRecoveryRuntime,
  readWalletPayRuntime,
} from '@/lib/piggyvest/wallet-pay-runtime';
import {
  checkWalletPayment,
  closeUnpaidVtuWalletPurchase,
  findWalletPaymentForPurchase,
  issueWalletPayment,
  payFromWallet,
  refundWalletPayment,
  walletPayDelivery,
} from '@/lib/piggyvest/wallet-pay-service';
import type { VtuWalletPayStepDeps } from './run-vtu-wallet-pay-step';

/**
 * Live wiring for the VTU wallet pay step (tests inject their own). Every
 * PiggyVest call runs on the wallet pay ledger's own database logins; the
 * customer is resolved on the caller's authenticated client.
 */
export function createVtuWalletPayStepDeps(auth: {
  supabase: SupabaseClient;
  user: User;
}): VtuWalletPayStepDeps {
  return {
    readPurchase: async (transactionId) => {
      const { data, error } = await auth.supabase.rpc(
        'get_vtu_wallet_pay_purchase',
        { p_transaction_id: transactionId }
      );
      if (error) throw new Error('VTU wallet pay purchase read failed');
      const row = (
        data as Array<{
          piggyvest_paid: boolean;
          amount: number | string;
          status: string;
          merchant_id: string;
          customer_id: string;
        }> | null
      )?.[0];
      return row
        ? {
            piggyvestPaid: row.piggyvest_paid === true,
            amount: Number(row.amount),
            status: row.status,
            merchantId: row.merchant_id,
            customerId: row.customer_id,
          }
        : null;
    },
    // New airtime/data/bills payments need their own switch on top of
    // wallet pay; re-checks and delivery use the recovery runtime.
    readRuntime: () =>
      isPiggyvestFeatureOn('wallet_pay_utilities')
        ? readWalletPayRuntime()
        : null,
    readRecoveryRuntime: readWalletPayRecoveryRuntime,
    resolveIdentity: (runtime) =>
      resolvePrimaryWalletIdentity({
        supabase: auth.supabase,
        user: auth.user,
        merchantId: runtime.merchantId,
        forOnboarding: false,
      }),
    findForPurchase: (input) => findWalletPaymentForPurchase(input),
    issue: (input) => issueWalletPayment(input) as never,
    check: (input) => checkWalletPayment(input),
    pay: (input) => payFromWallet(input),
    closeUnpaid: (input) => closeUnpaidVtuWalletPurchase(input),
    closeUnissued: async (transactionId) => {
      const { data, error } = await auth.supabase.rpc(
        'close_unissued_vtu_wallet_purchase',
        { p_transaction_id: transactionId }
      );
      if (error) throw new Error('VTU wallet pay close failed');
      return data === true;
    },
    delivery: (runtime) => {
      const delivery = walletPayDelivery(runtime);
      return {
        claim: delivery.claim,
        finish: delivery.finish,
        deliveryState: delivery.vtuDeliveryState,
        refund: (paymentId) => refundWalletPayment({ runtime, paymentId }),
      };
    },
  };
}
