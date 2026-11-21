import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePaystackSplitTransactionCharge } from '@/lib/payments/resolve-paystack-split-transaction-charge';
import { calculatePlatformFee } from '@/lib/paystack';
import { bankCardOfferCheckoutContextSchema } from '@/schemas/bank-card-offer-checkout-context';
import { bankCardOfferClaimSchema } from '@/schemas/bank-card-offer-claim';
import { getBankCardOfferCallbackOrigin } from './get-bank-card-offer-callback-origin';
import { hashBankCardOfferFilter } from './hash-bank-card-offer-filter';
import { initializeBankCardOfferPaystack } from './initialize-bank-card-offer-paystack';

export async function initializeBankCardOfferCheckout({
  client,
  merchantId,
  orderId,
  email,
  currency,
  request,
}: {
  client: Pick<SupabaseClient, 'rpc'>;
  merchantId: string;
  orderId: string;
  email: string;
  currency: string | undefined;
  request?: Request;
}) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  const domain = key?.startsWith('sk_test_')
    ? 'test'
    : key?.startsWith('sk_live_')
      ? 'live'
      : null;
  if (!domain || currency !== 'NGN') return { kind: 'unavailable' } as const;
  const args = { p_order_id: orderId, p_merchant_id: merchantId };
  const result = await client.rpc('get_bank_card_offer_checkout_context', args);
  const context = bankCardOfferCheckoutContextSchema.safeParse(result.data);
  if (
    result.error ||
    !context.success ||
    context.data.quote.merchantId !== merchantId ||
    email.trim().toLowerCase() !== context.data.customerEmail
  ) {
    return { kind: 'unavailable' } as const;
  }
  const { amountKobo, customerEmail, quote, slug, subaccount } = context.data;
  const callbackOrigin = await getBankCardOfferCallbackOrigin({
    request,
    merchantId,
    merchantSlug: slug,
  });
  if (!callbackOrigin)
    return { kind: 'retryable', reference: undefined } as const;
  const platformFeeKobo = calculatePlatformFee(amountKobo).platformFee;
  const { retainedShippingKobo, transactionChargeKobo } =
    await resolvePaystackSplitTransactionCharge({
      client,
      orderId,
      merchantId,
      amountKobo,
      customerEmail,
      platformFeeKobo,
    });
  const policyHash = hashBankCardOfferFilter(quote.paymentPolicy);
  const claim = await client.rpc('claim_bank_card_offer_attempt', {
    ...args,
    p_amount_kobo: amountKobo,
    p_domain: domain,
    p_policy_hash: policyHash,
    p_platform_fee_kobo: platformFeeKobo,
    p_retained_shipping_kobo: retainedShippingKobo,
  });
  const reserved = bankCardOfferClaimSchema.safeParse(claim.data);
  if (claim.error || !reserved.success) return { kind: 'unavailable' } as const;
  if ('retired' in reserved.data) return { kind: 'retired' } as const;
  const { claimed, reference, checkoutUrl } = reserved.data;
  const review = (failed: boolean) =>
    client.rpc('request_bank_card_offer_initialization_review', {
      ...args,
      p_reference: reference,
      p_failed: failed,
    });
  async function requestReview(immediate: boolean) {
    const flagged = await review(immediate);
    if (flagged.error)
      throw new Error('Unable to record bank offer initialization review');
    return flagged.data === true
      ? ({ kind: 'pending', reference } as const)
      : ({ kind: 'retryable', reference } as const);
  }
  if (!claimed) {
    if (checkoutUrl)
      return { kind: 'initialized', reference, checkoutUrl } as const;
    return requestReview(false);
  }
  let url: string;
  try {
    url = await initializeBankCardOfferPaystack({
      attempt: {
        ...context.data,
        currency: 'NGN',
        domain,
        reference,
        acceptedFilterPolicyHash: policyHash,
        adjustmentsKobo:
          amountKobo - (quote.productSubtotalKobo - quote.discountKobo),
      },
      subaccount,
      transactionChargeKobo,
      callbackUrl: `${callbackOrigin}/checkout/success?reference=${reference}`,
    });
  } catch {
    // Paystack may have accepted the initialization. Send the same reference
    // to operations without opening a second provider session.
    return requestReview(true);
  }

  async function save() {
    try {
      const result = await client.rpc('record_bank_card_offer_checkout_url', {
        ...args,
        p_reference: reference,
        p_checkout_url: url,
      });
      return result.error
        ? 'unavailable'
        : result.data === true
          ? 'saved'
          : 'rejected';
    } catch {
      return 'unavailable';
    }
  }
  let saved = await save();
  if (saved === 'unavailable') saved = await save();
  // A refused or unconfirmed write does not establish that this URL is
  // usable for the saved attempt. Reconcile the existing reference first.
  if (saved !== 'saved') return requestReview(true);
  return { kind: 'initialized', reference, checkoutUrl: url } as const;
}
