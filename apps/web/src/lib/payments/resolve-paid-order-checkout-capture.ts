import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { calculatePlatformFee } from './platform-fee';

const captureDecision = z.object({
  customerFeeMinor: z.number().int().nonnegative().optional(),
  outcome: z.enum([
    'ready',
    'review',
    'unapplied',
    'awaiting_evidence',
    'original_replay',
  ]),
});

export async function resolvePaidOrderCheckoutCapture({
  gatewayResponse,
  reference,
  signedEvent,
  supabase,
}: {
  gatewayResponse: Record<string, unknown>;
  reference: string;
  signedEvent?: Record<string, unknown>;
  supabase: Pick<SupabaseClient, 'rpc'>;
}) {
  delete gatewayResponse.baci_paystack_checkout_customer_fee_minor;
  const eventMatchesCapture =
    signedEvent?.reference === reference &&
    signedEvent.id !== undefined &&
    String(signedEvent.id) === String(gatewayResponse.id);
  const integration =
    gatewayResponse.integration ??
    (eventMatchesCapture ? signedEvent.integration : undefined);
  const amount = gatewayResponse.amount;
  const requested = gatewayResponse.requested_amount;
  const platformFeeBasis =
    typeof requested === 'number' &&
    typeof amount === 'number' &&
    Number.isSafeInteger(requested) &&
    requested > 0 &&
    Number.isSafeInteger(amount) &&
    requested <= amount &&
    amount - requested === gatewayResponse.fees
      ? requested
      : amount;
  const integrationId =
    process.env.PAID_ORDER_AMENDMENT_PAYSTACK_INTEGRATION_ID;
  const secret = process.env.PAYSTACK_SECRET_KEY ?? '';
  const configuredIntegration =
    integrationId &&
    /^[1-9][0-9]{0,18}$/.test(integrationId) &&
    ((gatewayResponse.domain === 'test' && secret.startsWith('sk_test_')) ||
      (gatewayResponse.domain === 'live' && secret.startsWith('sk_live_')))
      ? integrationId
      : undefined;
  const fee =
    typeof platformFeeBasis === 'number' &&
    Number.isSafeInteger(platformFeeBasis) &&
    platformFeeBasis > 0
      ? calculatePlatformFee(platformFeeBasis, {
          currency: 'NGN',
          unit: 'minor',
          rounding: 'integer',
        }).platformFee
      : null;

  const { data, error } = await supabase.rpc(
    'resolve_paid_order_checkout_capture',
    {
      p_platform_fee_minor: fee,
      p_reference: reference,
      p_verified: {
        amount,
        channel: gatewayResponse.channel,
        currency: gatewayResponse.currency,
        id: gatewayResponse.id,
        integration,
        reference: gatewayResponse.reference,
        requested_amount: requested,
        fees: gatewayResponse.fees,
        subaccount: gatewayResponse.subaccount,
        fees_split: gatewayResponse.fees_split,
        configured_integration: configuredIntegration,
        status: gatewayResponse.status,
      },
    }
  );
  if (error) return 'unavailable';
  if (data === null) return 'untracked';
  const parsed = captureDecision.safeParse(data);
  if (!parsed.success) return 'unavailable';
  if (parsed.data.outcome === 'ready' && parsed.data.customerFeeMinor) {
    gatewayResponse.baci_paystack_checkout_customer_fee_minor =
      parsed.data.customerFeeMinor;
  }
  return parsed.data.outcome;
}
