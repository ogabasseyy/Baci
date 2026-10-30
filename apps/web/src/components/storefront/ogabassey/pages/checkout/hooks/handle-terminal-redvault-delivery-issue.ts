import { toast } from '@/hooks/use-toast';
import type { QuoteProviderCode } from '@/lib/shipping/types';
import type { ShippingQuote } from '@/types/shipping-quote';
import { handleSharedRedvaultReview } from '../handlers/handle-shared-redvault-review';
import { recoverTerminalRedvaultReviewForContext } from '../handlers/recover-terminal-redvault-review';
import { isTerminalRedvaultReview } from '../is-terminal-redvault-review';
import {
  type PrepareCheckoutOrderSubmissionOptions,
  type PrepareCheckoutOrderSubmissionResult,
  prepareCheckoutOrderSubmission,
} from '../prepare-checkout-order-submission';
import { readRedvaultReviewRecovery } from '../read-redvault-review-recovery';
import { redvaultTerminalFingerprintMatches } from '../redvault-terminal-fingerprint';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';

type Issue = Extract<
  PrepareCheckoutOrderSubmissionResult,
  { kind: 'issue' }
>['issue'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reviewedShipping(fingerprint: string) {
  try {
    const value: unknown = JSON.parse(
      fingerprint.slice('uba_redvault:'.length)
    );
    if (!isRecord(value)) return null;
    const fields = value;
    const address = fields.shippingAddress;
    if (
      typeof fields.deliveryMethod !== 'string' ||
      typeof fields.shippingFee !== 'number' ||
      !Number.isFinite(fields.shippingFee) ||
      fields.shippingFee < 0 ||
      typeof fields.shippingProvider !== 'string' ||
      (fields.merchantRateId != null &&
        typeof fields.merchantRateId !== 'string') ||
      !isRecord(address) ||
      typeof address.address !== 'string'
    )
      return null;
    return {
      method: fields.deliveryMethod,
      fee: fields.shippingFee,
      provider: fields.shippingProvider,
      merchantRateId: fields.merchantRateId ?? null,
      address: address.address,
    };
  } catch {
    return null;
  }
}

function reviewedQuote(
  shipping: NonNullable<ReturnType<typeof reviewedShipping>>
): ShippingQuote | null {
  let provider: QuoteProviderCode;
  if (shipping.merchantRateId) provider = 'MERCHANT';
  else if (shipping.provider.toUpperCase() === 'GIGL') provider = 'GIGL';
  else if (shipping.provider.toUpperCase() === 'TOPSHIP') provider = 'TOPSHIP';
  else return null;
  return {
    id: shipping.merchantRateId
      ? `mrate_${shipping.merchantRateId}`
      : '__reviewed_order__',
    provider,
    serviceTier: '',
    carrierName: '',
    displayName: shipping.address,
    estimatedDays: 0,
    price: shipping.fee,
    currency: 'NGN',
    pickupIncluded: false,
    insuranceIncluded: false,
    stationName: shipping.address,
  };
}

/** Continue or release a closed-cart review without requesting a new quote. */
export async function handleTerminalRedvaultDeliveryIssue(
  context: CheckoutOrderSubmissionContext,
  merchant: NonNullable<CheckoutOrderSubmissionContext['merchant']>,
  options: PrepareCheckoutOrderSubmissionOptions,
  issue: Issue
): Promise<boolean> {
  if (
    ![
      'delivery-option',
      'delivery-required',
      'shipping-expired',
      'incomplete-address',
    ].includes(issue) ||
    !isTerminalRedvaultReview({
      merchantId: merchant.id,
      pendingOrder: context.order.pending,
      sharedCartEnabled: context.cart.sharedCartEnabled,
      sharedCartRef: context.cart.sharedCartRef,
      checkoutItemCount: context.cart.checkoutCart.length,
    })
  )
    return false;

  const review = readRedvaultReviewRecovery(context.order.pending, merchant.id);
  if (!review) return false;
  const cancelChangedReview = () =>
    recoverTerminalRedvaultReviewForContext(context, merchant.id, '');
  if (options.payment.method !== 'uba_redvault') return cancelChangedReview();

  const shipping = reviewedShipping(review.ready.checkoutFingerprint);
  if (shipping && shipping.method !== options.delivery.method)
    return cancelChangedReview();
  if (issue === 'incomplete-address') return cancelChangedReview();

  // A populated quote set can represent a newly selected option. Do not
  // replace it with the previous order's quote or silently resume that order.
  if (options.delivery.quotes.length > 0) return false;
  const quote = shipping && reviewedQuote(shipping);
  const selected = options.delivery.selectedQuoteId;
  if (
    shipping &&
    selected &&
    ((shipping.merchantRateId && selected !== quote?.id) ||
      (!shipping.merchantRateId && selected.startsWith('mrate_')))
  )
    return cancelChangedReview();

  const missingSavedAddress =
    options.delivery.method === 'door' &&
    !options.delivery.isNewAddressMode &&
    !options.delivery.addresses.some(
      (address) => address.id === options.delivery.selectedAddressId
    );
  if (!shipping || !quote || missingSavedAddress) {
    toast({
      title: 'Previous UBA checkout needs attention',
      description:
        'We could not restore the previous delivery details. Please try again.',
      variant: 'destructive',
    });
    context.processing.releaseSubmission();
    return true;
  }

  // This reconstructed quote is used only to compare the existing review;
  // handleSharedRedvaultReview's prepared-only path cannot create an order.
  const prepared = prepareCheckoutOrderSubmission({
    ...options,
    payment: { ...options.payment, redvaultAvailable: true },
    delivery: {
      ...options.delivery,
      selectedQuoteId: quote.id,
      selectedQuoteMatchesMethod: true,
      quotes: [quote],
      deliveryCost: shipping.fee,
    },
  });
  if (prepared.kind === 'issue') {
    if (prepared.issue === 'incomplete-address') return cancelChangedReview();
    toast({
      title: 'Previous UBA checkout needs attention',
      description: 'We could not restore the previous order. Please try again.',
      variant: 'destructive',
    });
    context.processing.releaseSubmission();
    return true;
  }
  if (
    !redvaultTerminalFingerprintMatches(
      review.ready.checkoutFingerprint,
      prepared.identity.checkoutFingerprint
    )
  )
    return cancelChangedReview();

  const ready = context.payment.session.redvault.orderReady;
  if (
    !ready ||
    ready.orderId !== review.ready.orderId ||
    ready.cartId !== review.ready.cartId ||
    ready.trackingToken !== review.ready.trackingToken ||
    ready.checkoutFingerprint !== review.ready.checkoutFingerprint ||
    ready.customerEmail !== review.ready.customerEmail ||
    ready.customerName !== review.ready.customerName ||
    ready.customerPhone !== review.ready.customerPhone ||
    ready.currency !== review.ready.currency ||
    ready.total !== review.ready.total ||
    ready.billingAddress?.line1 !== review.ready.billingAddress.line1 ||
    ready.billingAddress?.city !== review.ready.billingAddress.city ||
    ready.billingAddress?.state !== review.ready.billingAddress.state ||
    ready.billingAddress?.country !== review.ready.billingAddress.country ||
    ready.billingAddress?.zip_code !== review.ready.billingAddress.zip_code
  ) {
    toast({
      title: 'Previous UBA checkout needs attention',
      description: 'We could not restore the previous order. Please try again.',
      variant: 'destructive',
    });
    context.processing.releaseSubmission();
    return true;
  }
  if (!context.payment.redvaultAvailable) {
    toast({
      title: 'Payment Unavailable',
      description:
        'Pay with UBA is not available right now. Please choose a different payment method.',
      variant: 'destructive',
    });
    context.processing.releaseSubmission();
    return true;
  }
  if (await handleSharedRedvaultReview(context, merchant, prepared))
    return true;
  toast({
    title: 'Previous UBA checkout needs attention',
    description: 'We could not restore the previous order. Please try again.',
    variant: 'destructive',
  });
  context.processing.releaseSubmission();
  return true;
}
