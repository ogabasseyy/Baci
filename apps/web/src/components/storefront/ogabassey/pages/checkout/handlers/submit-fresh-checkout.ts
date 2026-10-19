import type { BuildCheckoutOrderLifecycleOptionsInput } from '../build-checkout-order-lifecycle-options';
import {
  buildCheckoutOrderLifecycleOptions,
} from '../build-checkout-order-lifecycle-options';
import { submitRedvaultPreparedOrder } from './redvault-prepared-order-submit';
import {
  runCheckoutOrderLifecycle,
  type CheckoutOrderLifecycleResult,
} from './checkout-order-lifecycle';
import {
  continueCheckoutPayment,
  type ContinueCheckoutPaymentOptions,
} from './continue-checkout-payment';

type RedvaultPreparedInput = Parameters<
  typeof submitRedvaultPreparedOrder
>[0];

export interface PaymentAttemptTracker {
  capturePaymentStarted: (reference?: string) => void;
  hasPaymentStarted: () => boolean;
  setInitializedReference: (reference: string | undefined) => void;
}

export interface SubmitFreshCheckoutOptions {
  redvaultPrepared: Omit<RedvaultPreparedInput, 'onPaymentStarted'>;
  lifecycle: BuildCheckoutOrderLifecycleOptionsInput;
  onRedvaultPaymentStarted: NonNullable<RedvaultPreparedInput['onPaymentStarted']>;
  createPaymentOptions: (
    result: Extract<CheckoutOrderLifecycleResult, { kind: 'payment_ready' }>
  ) => Omit<ContinueCheckoutPaymentOptions, 'hasPaymentStarted' | 'setInitializedReference'>;
  handleError: (
    error: unknown,
    failure: {
      createdOrderId?: string;
      paymentStarted: boolean;
      payment: {
        currency: string;
        orderNumber: string;
        paymentMethod: BuildCheckoutOrderLifecycleOptionsInput['state']['paymentMethod'];
        reference?: string;
      };
    }
  ) => void;
}

/** Run the fresh-order path from prepared REDVAULT reuse through payment dispatch. */
export async function submitFreshCheckout({
  redvaultPrepared,
  lifecycle,
  onRedvaultPaymentStarted,
  createPaymentOptions,
  handleError,
}: SubmitFreshCheckoutOptions): Promise<void> {
  let createdOrderId: string | undefined;
  let createdOrderNumber = '';
  let orderChargeCurrency = lifecycle.state.currency;
  let paymentStarted = false;
  let initializedReference: string | undefined;

  const tracker: PaymentAttemptTracker = {
    capturePaymentStarted: (reference) => {
      paymentStarted = true;
      initializedReference = reference;
    },
    hasPaymentStarted: () => paymentStarted,
    setInitializedReference: (reference) => {
      initializedReference = reference;
    },
  };

  try {
    const preparedOrderHandled = await submitRedvaultPreparedOrder({
      ...redvaultPrepared,
      onPaymentStarted: (started) => {
        tracker.capturePaymentStarted(started.reference);
        onRedvaultPaymentStarted(started);
      },
    });
    if (preparedOrderHandled) return;

    const options = buildCheckoutOrderLifecycleOptions(lifecycle);
    const onOrderCreated = options.onOrderCreated;
    const result = await runCheckoutOrderLifecycle({
      ...options,
      onOrderCreated: (created) => {
        createdOrderId = created.orderId;
        createdOrderNumber = created.orderNumber;
        orderChargeCurrency = created.currency;
        onOrderCreated(created);
      },
    });
    if (result.kind !== 'payment_ready') return;

    const paymentOptions = createPaymentOptions(result);
    await continueCheckoutPayment({
      ...paymentOptions,
      capturePaymentStarted: (reference) => {
        tracker.capturePaymentStarted(reference);
        paymentOptions.capturePaymentStarted(reference);
      },
      hasPaymentStarted: tracker.hasPaymentStarted,
      setInitializedReference: tracker.setInitializedReference,
    });
  } catch (error) {
    handleError(error, {
      createdOrderId,
      paymentStarted,
      payment: {
        currency: orderChargeCurrency,
        orderNumber: createdOrderNumber,
        paymentMethod: lifecycle.state.paymentMethod,
        reference: initializedReference,
      },
    });
  }
}
