import type { ImeiRpcClient } from '@/lib/imei-access';

/** Requires the server-controlled IMEI RPC boundary. */
export async function redeemImeiWalletPayment({
  amount,
  customerId,
  lookupId,
  merchantId,
  supabaseAdmin,
}: {
  amount: number;
  customerId: string;
  lookupId: string;
  merchantId: string;
  supabaseAdmin: ImeiRpcClient;
}) {
  const { error } = await supabaseAdmin.rpc('redeem_imei_wallet_payment', {
    p_amount: amount,
    p_customer_id: customerId,
    p_description: `IMEI lookup payment: ${lookupId}`,
    p_lookup_id: lookupId,
    p_merchant_id: merchantId,
  });

  if (error) {
    throw error;
  }
}
