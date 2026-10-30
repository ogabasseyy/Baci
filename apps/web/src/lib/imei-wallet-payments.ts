import type { ImeiDeviceCategory } from '@baci/shared/imei';
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

/** Atomically debits the wallet and persists a Petrock write-ahead intent. */
export async function redeemImeiWalletAndBeginProviderSubmission({
  amount,
  costUsd,
  customerId,
  deviceCategory,
  feedbackTokenHash,
  identifierCiphertext,
  lookupId,
  merchantId,
  providerAttemptStartedAt,
  referenceId,
  supabaseAdmin,
}: {
  amount: number;
  costUsd: number;
  customerId: string;
  deviceCategory?: ImeiDeviceCategory;
  feedbackTokenHash: string;
  identifierCiphertext: string;
  lookupId: string;
  merchantId: string;
  providerAttemptStartedAt: string;
  referenceId: string;
  supabaseAdmin: ImeiRpcClient;
}) {
  const { error } = await supabaseAdmin.rpc(
    'redeem_imei_wallet_and_begin_provider_submission',
    {
      p_amount: amount,
      p_cost_usd: costUsd,
      p_customer_id: customerId,
      p_description: `Petrock IMEI lookup payment: ${lookupId}`,
      p_device_category: deviceCategory ?? null,
      p_feedback_token_hash: feedbackTokenHash,
      p_identifier_ciphertext: identifierCiphertext,
      p_lookup_id: lookupId,
      p_merchant_id: merchantId,
      p_provider: 'petrock',
      p_provider_attempt_started_at: providerAttemptStartedAt,
      p_reference_id: referenceId,
    }
  );

  if (error) throw error;
}

/** Requires the server-controlled IMEI RPC boundary. */
export async function refundImeiWalletPayment({
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
  const { error } = await supabaseAdmin.rpc('refund_imei_wallet_payment', {
    p_amount: amount,
    p_customer_id: customerId,
    p_description: `IMEI lookup refund: ${lookupId}`,
    p_lookup_id: lookupId,
    p_merchant_id: merchantId,
  });

  if (error) {
    throw error;
  }
}
