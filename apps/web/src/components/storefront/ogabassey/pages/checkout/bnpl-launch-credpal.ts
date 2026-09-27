import type { Route } from 'next';
import { openCredPalCheckout } from '@/lib/credpal';
import { toCurrencyAmount } from '@/lib/klump-utils';
import { captureBnplPaymentCompleted } from './capture-bnpl-payment-completed';
import {
    bridgeOpenedAttemptError,
    notifyNativeBnplClose,
    notifyNativeBnplProviderOpened,
} from './native-bnpl-bridge';
import type { BnplLaunchOrderContext } from './bnpl-launch-context';
import {
    clearPaymentLaunch,
    tryStartPaymentLaunch,
} from './bnpl-launch-keys';

/**
 * CredPal launch branch: opens the provider widget for a validated order
 * total, confirms the provider flow to the native host on load, records
 * the paid conversion only for approved applications (pending results
 * verify on the success page), and bridges an opened-then-failed attempt
 * instead of rendering local error UI for it.
 */
export async function launchCredPalCheckout({
    order,
    trackingToken,
    checkoutCustomerEmail,
    checkoutCustomerPhone,
    checkoutCustomerName,
    paymentLaunchKeyRef,
    providerOpenedLaunchKeyRef,
    router,
    setStatus,
    setErrorMessage,
}: BnplLaunchOrderContext): Promise<void> {
    const { getCredPalKey } = await import('@/lib/credpal');
    const credPalAmount = toCurrencyAmount(order.total);
    if (credPalAmount <= 0) {
        throw new Error('Invalid order total for CredPal checkout.');
    }

    const launchKey = `credpal:${order.id}:${order.tracking_token || trackingToken || ''}`;
    if (!tryStartPaymentLaunch(paymentLaunchKeyRef, launchKey)) {
        return;
    }
    // New attempt: a later SDK error bridges to native only once
    // onLoad proves this attempt's provider flow opened.
    providerOpenedLaunchKeyRef.current = null;

    await openCredPalCheckout({
        key: getCredPalKey(),
        amount: credPalAmount,
        product: `Order #${order.id}`,
        customerEmail: checkoutCustomerEmail || '',
        customerName: checkoutCustomerName,
        customerPhone: checkoutCustomerPhone || '',
        onLoad: () => {
            // The widget loaded: confirm the provider flow to
            // native so the start is recorded only for opened
            // checkouts.
            providerOpenedLaunchKeyRef.current = launchKey;
            notifyNativeBnplProviderOpened('credpal', order.id);
        },
        onSuccess: (data) => {
            // Accepted-but-pending applications are not paid
            // conversions; the success page verifies the outcome.
            if (data.status === 'success') {
                captureBnplPaymentCompleted({
                    orderId: order.id,
                    paymentMethod: 'credpal',
                    reference: data.order_no,
                    value: Number(order.total),
                });
            }
            const successQuery = new URLSearchParams({
                orderId: order.id,
                reference: data.order_no,
                type: 'credpal',
            });
            if (data.status) {
                // Lets native hosts skip paid attribution for pending results.
                successQuery.set('credpalStatus', data.status);
            }
            if (order.tracking_token) {
                successQuery.set('trackingToken', order.tracking_token);
            }
            router.push(`/order-success?${successQuery.toString()}` as Route);
        },
        onClose: () => {
            if (notifyNativeBnplClose('credpal')) {
                clearPaymentLaunch(paymentLaunchKeyRef);
                return;
            }

            clearPaymentLaunch(paymentLaunchKeyRef);
            setStatus('error');
            setErrorMessage('Payment cancelled.');
        },
        onError: (error) => {
            if (
                bridgeOpenedAttemptError({
                    providerOpenedLaunchKeyRef,
                    launchKey,
                    gateway: 'credpal',
                    orderId: order.id,
                    message: error.message,
                })
            ) {
                clearPaymentLaunch(paymentLaunchKeyRef);
                return;
            }
            clearPaymentLaunch(paymentLaunchKeyRef);
            setStatus('error');
            setErrorMessage(error.message);
        },
    });
}
