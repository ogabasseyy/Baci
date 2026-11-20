import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/supabase/mobile-auth';
import { bankCardOfferReferenceSchema } from '@/schemas/bank-card-offer-reference';
import {
  doesBankOfferMerchantMatch,
  getBankCardOfferVerificationBinding,
} from './get-bank-card-offer-verification-binding';
import type { PaymentVerificationDependencies } from './payment-verification-dependencies';
import { readSessionlessPaymentReferenceSnapshot } from './sessionless-payment-reference-snapshot';
import type { verifySessionlessBankCardOffer } from './verify-sessionless-bank-card-offer';

function unavailable() {
  return NextResponse.json(
    { error: 'Verification unavailable' },
    { status: 503 }
  );
}

function denied() {
  return NextResponse.json(
    {
      error: 'Verification unavailable',
      code: 'BANK_CARD_OFFER_VERIFICATION_DENIED',
    },
    { status: 403 }
  );
}

export async function verifyBankCardOfferRequest(
  request: Request,
  reference: string,
  merchantSlug: string | undefined,
  { load, finalize }: PaymentVerificationDependencies,
  verifyNative: (
    snapshot: Parameters<typeof verifySessionlessBankCardOffer>[0],
    client: Parameters<typeof verifySessionlessBankCardOffer>[1]
  ) => ReturnType<typeof verifySessionlessBankCardOffer>
) {
  if (!bankCardOfferReferenceSchema.safeParse(reference).success) {
    return NextResponse.json({ error: 'Invalid reference' }, { status: 400 });
  }

  const authorization = request.headers.get('authorization');
  if (authorization && /^bearer\s+.+$/i.test(authorization)) {
    try {
      const auth = await getAuthenticatedUser(request);
      if (auth?.authMode !== 'bearer') return denied();
      const snapshot = await readSessionlessPaymentReferenceSnapshot(
        auth.supabase,
        reference
      );
      if (!snapshot) return denied();
      // Account history may omit the slug. When a storefront is supplied,
      // it must match the buyer-owned order's merchant.
      if (
        merchantSlug &&
        !(await doesBankOfferMerchantMatch(
          auth.supabase,
          merchantSlug,
          snapshot.merchantId
        ))
      ) {
        return denied();
      }
      return await verifyNative(snapshot, auth.supabase);
    } catch {
      return unavailable();
    }
  }

  const binding = await getBankCardOfferVerificationBinding(
    request,
    reference,
    merchantSlug
  );
  if (binding === 'unavailable') return unavailable();
  if (!binding) return denied();

  const lookup = await load(reference);
  if (!lookup.ok) return lookup.response;
  const { supabase, transaction } = lookup;
  if (
    transaction.order_id !== binding.orderId ||
    transaction.merchant_id !== binding.merchantId
  ) {
    logger.warn({ message: 'Payment verification order binding mismatch' });
    return denied();
  }
  if (transaction.gateway !== 'paystack') {
    return NextResponse.json(
      { error: 'Invalid bank offer capture' },
      { status: 400 }
    );
  }

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, order_number, payment_status, shipping_status, total')
    .eq('id', binding.orderId)
    .maybeSingle();
  if (error) return unavailable();

  return finalize({
    reference,
    gateway: 'paystack',
    orderId: binding.orderId,
    transaction,
    existingOrder: order,
    isBankOfferReference: true,
    supabase,
  });
}
