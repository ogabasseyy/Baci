import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { verifyCheckoutCompletionAuthorization } from '@/lib/agentic/checkout-authorization';
import {
  buildAuthorizationErrorBody,
  getAuthorizationErrorStatus,
  getCheckoutGrandTotal,
  withCompletionAuthorizationMetadata,
} from '@/lib/agentic/checkout-completion-authorization-response';
import { createAgenticCheckoutPaymentAccount } from '@/lib/agentic/checkout-payment-account';
import {
  buildCheckoutPaymentClaimReference,
  claimCheckoutPaymentSetup,
  markCheckoutPaymentAccountReady,
} from '@/lib/agentic/checkout-payment-claim';
import { releaseCheckoutPaymentClaimAfterFailure } from '@/lib/agentic/checkout-payment-claim-release';
import type {
  CheckoutSessionCalculation,
  PrepareCheckoutPaymentInput,
  PrepareCheckoutPaymentResult,
} from '@/lib/agentic/checkout-payment-setup-types';
import {
  buildAgenticMetadata,
  mapCheckoutSessionStatus,
} from '@/lib/agentic/checkout-storage';
import { isValidPaystackSubaccountCode } from '@/lib/agentic/paystack';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export async function prepareAgenticCheckoutPayment({
  authorizationSecrets,
  buyer,
  canResumePaymentAccount,
  completionAuthorization,
  merchantId,
  metadata,
  paystackSubaccountCode,
  session,
  sessionCalc,
  sessionId,
  storedDvaAccount,
  supabase,
}: PrepareCheckoutPaymentInput): Promise<PrepareCheckoutPaymentResult> {
  if (canResumePaymentAccount && storedDvaAccount) {
    return {
      ok: true,
      payment: {
        dvaAccount: storedDvaAccount,
        metadata,
        session,
        sessionCalc,
      },
    };
  }
  if (!isValidPaystackSubaccountCode(paystackSubaccountCode)) {
    return {
      body: { error: 'Merchant Paystack subaccount is not configured' },
      ok: false,
      status: 424,
    };
  }
  const claimReference = buildCheckoutPaymentClaimReference(sessionId);
  const releaseClaim = (failureDetails: Record<string, unknown>) =>
    releaseCheckoutPaymentClaimAfterFailure({
      buyer,
      claimReference,
      failureDetails,
      merchantId,
      metadata,
      sessionId,
      supabase,
    });
  const claim = await claimCheckoutPaymentSetup({
    buyer,
    claimReference,
    merchantId,
    metadata,
    sessionId,
    supabase,
  });

  if (claim.error) {
    logger.error({
      message: 'Checkout payment setup claim failed',
      error: sanitizeForLog(claim.error),
      sessionId: sanitizeForLog(sessionId),
    });
    return {
      body: { error: 'Database error' },
      ok: false,
      status: 500,
    };
  }
  if (!claim.claimed || !claim.session) {
    return {
      body: {
        error: 'Session already has pending payment',
        status: 'payment_pending',
      },
      ok: false,
      status: 409,
    };
  }

  let claimedSessionCalc: CheckoutSessionCalculation;
  try {
    claimedSessionCalc = await calculateCheckoutSession(
      supabase,
      claim.session.cart_items,
      claim.session.shipping_method,
      claim.session.currency,
      merchantId
    );
  } catch (error) {
    await releaseClaim({ payment_error: 'claimed_session_calculation_failed' });
    logger.error({
      message: 'Claimed checkout calculation failed',
      error: sanitizeForLog(error),
      sessionId: sanitizeForLog(sessionId),
    });
    return {
      body: { error: 'Checkout calculation failed' },
      ok: false,
      status: 500,
    };
  }
  const claimedStatus = mapCheckoutSessionStatus({
    status: claim.session.status,
    hasFulfillmentAddress: !!claim.session.shipping_address,
    hasLineItems: claimedSessionCalc.lineItems.length > 0,
  });

  if (claimedStatus !== 'ready_for_payment') {
    await releaseClaim({ payment_error: 'claimed_session_not_ready' });
    return {
      body: {
        error: 'Session is not ready for payment',
        status: claimedStatus,
      },
      ok: false,
      status: 409,
    };
  }

  const calculationErrors = claimedSessionCalc.messages.filter(
    (message) => message.type === 'error'
  );
  if (calculationErrors.length > 0) {
    await releaseClaim({ payment_error: 'claimed_session_calculation_error' });
    return {
      body: {
        error: 'Checkout calculation has errors',
        messages: calculationErrors,
      },
      ok: false,
      status: 409,
    };
  }

  let claimedGrandTotal: number;
  try {
    claimedGrandTotal = getCheckoutGrandTotal(claimedSessionCalc.totals);
  } catch (error) {
    await releaseClaim({ payment_error: 'claimed_session_total_invalid' });
    logger.error({
      message: 'Claimed checkout total is invalid',
      error: sanitizeForLog(error),
      sessionId: sanitizeForLog(sessionId),
    });
    return {
      body: { error: 'Could not calculate total' },
      ok: false,
      status: 500,
    };
  }

  const claimedAuthorization = verifyCheckoutCompletionAuthorization({
    amount: claimedGrandTotal,
    authorization: completionAuthorization,
    currency: claim.session.currency,
    secrets: authorizationSecrets,
    sessionId: claim.session.session_id,
  });
  if (!claimedAuthorization.ok) {
    await releaseClaim({
      payment_error: `authorization_${claimedAuthorization.code}`,
    });
    return {
      body: buildAuthorizationErrorBody(claimedAuthorization.code),
      ok: false,
      status: getAuthorizationErrorStatus(claimedAuthorization.code),
    };
  }

  const claimedMetadata = withCompletionAuthorizationMetadata(
    buildAgenticMetadata({
      existingMetadata: claim.session.metadata,
      fulfillmentOptions: claimedSessionCalc.fulfillmentOptions,
      lineItems: claimedSessionCalc.lineItems,
      messages: claimedSessionCalc.messages,
      totals: claimedSessionCalc.totals,
    }),
    claimedAuthorization.mode
  );

  const paymentAccount = await createAgenticCheckoutPaymentAccount({
    buyer,
    paystackSubaccountCode,
  });
  if (!paymentAccount.ok) {
    logger.error({
      message: 'DVA Creation Failed',
      sessionId: sanitizeForLog(sessionId),
    });
    // The provider may have created an account before the error arrived.
    // Retain the claim until that outcome can be reconciled.
    return {
      body: {
        error: 'Failed to generate payment account',
        details: 'Payment provider error',
      },
      ok: false,
      status: 502,
    };
  }

  const accountReady = await markCheckoutPaymentAccountReady({
    buyer,
    claimReference,
    dvaAccount: paymentAccount.account,
    merchantId,
    metadata: claimedMetadata,
    sessionId,
    supabase,
  });

  if (!accountReady.stored) {
    const maskedAccountNumber = maskAccountNumber(
      paymentAccount.account.account_number
    );
    const conflict =
      accountReady.error &&
      typeof accountReady.error === 'object' &&
      'code' in accountReady.error &&
      accountReady.error.code === POSTGRES_UNIQUE_VIOLATION;
    // The provider returned an account; releasing this claim could issue a
    // second one even though its persistence outcome is uncertain.
    logger.error({
      message: 'Checkout payment account state update failed',
      paymentAccount: maskedAccountNumber,
      sessionId: sanitizeForLog(sessionId),
    });
    if (conflict) {
      return {
        body: { error: 'Session already has pending payment for this account' },
        ok: false,
        status: 409,
      };
    }
    return {
      body: { error: 'Database error' },
      ok: false,
      status: 500,
    };
  }
  return {
    ok: true,
    payment: {
      dvaAccount: paymentAccount.account,
      metadata: claimedMetadata,
      session: claim.session,
      sessionCalc: claimedSessionCalc,
    },
  };
}

function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, '');
  return digits.length <= 4
    ? '****'
    : `${'*'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}
