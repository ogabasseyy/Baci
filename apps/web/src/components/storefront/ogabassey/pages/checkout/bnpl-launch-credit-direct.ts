import { openCreditDirectCheckout } from '@/lib/credit-direct-client';
import { apiPost } from '@/lib/api-client';
import {
    clearCreditDirectPopupMarker,
    writeCreditDirectPopupMarker,
} from './credit-direct-popup-return';
import { captureCreditDirectClientCompletion } from './credit-direct-client-completion';
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
 * Credit Direct launch branch: opens the provider popup for a validated
 * order total, confirms the provider flow to the native host on popup,
 * and bridges an opened-then-failed attempt instead of rendering local
 * error UI for it. A pre-popup failure stays local (no start exists).
 */
export async function launchCreditDirectCheckout({
    order,
    slug,
    trackingToken,
    checkoutCustomerEmail,
    checkoutCustomerPhone,
    checkoutCustomerName,
    paymentLaunchKeyRef,
    providerOpenedLaunchKeyRef,
    setStatus,
    setErrorMessage,
    setCreditDirectPopupMarker,
}: BnplLaunchOrderContext): Promise<void> {
    const normalizedAmount = Number(order.total);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        throw new Error('Invalid order total for Credit Direct checkout.');
    }

    const launchKey = `credit-direct:${order.id}:${order.tracking_token || trackingToken || ''}`;
    if (!tryStartPaymentLaunch(paymentLaunchKeyRef, launchKey)) {
        return;
    }
    // New attempt: a later SDK error bridges to native only once
    // onPopup proves this attempt's provider flow opened.
    providerOpenedLaunchKeyRef.current = null;

    await openCreditDirectCheckout({
        merchantSlug: slug,
        orderId: order.id,
        trackingToken: order.tracking_token ?? '',
        amount: normalizedAmount,
        customerEmail: checkoutCustomerEmail || '',
        customerPhone: checkoutCustomerPhone || '',
        customerName: checkoutCustomerName,
        items: order.items.map(
            (item: {
                product_id?: string;
                id?: string;
                product_name?: string;
                name?: string;
                price: number;
                quantity: number;
            }) => ({
                id: String(item.product_id || item.id),
                name: item.product_name || item.name || '',
                price: item.price,
                quantity: item.quantity,
            })
        ),
        onSuccess: ({ checkoutTransactionId, sessionId }) => {
            const marker = captureCreditDirectClientCompletion({
                orderId: order.id,
                checkoutTransactionId,
                customerEmail: checkoutCustomerEmail,
                sessionId,
                trackingToken: order.tracking_token,
            });
            setCreditDirectPopupMarker(marker);
        },
        onPopup: async ({ checkoutTransactionId, sessionId }) => {
            // The popup opened: confirm the provider flow to native
            // before persisting anything else.
            providerOpenedLaunchKeyRef.current = launchKey;
            notifyNativeBnplProviderOpened('credit_direct', order.id);
            writeCreditDirectPopupMarker(
                order.id,
                checkoutTransactionId || sessionId
            );
            if (!checkoutTransactionId) {
                return;
            }
            try {
                await apiPost('/api/orders/update-payment-ref', {
                    gateway: 'credit_direct',
                    orderId: order.id,
                    paymentRef: checkoutTransactionId,
                    ...(order.tracking_token && {
                        tracking_token: order.tracking_token,
                    }),
                });
            } catch (error) {
                console.error(
                    'Failed to persist Credit Direct popup reference:',
                    error instanceof Error ? error.message : error
                );
            }
        },
        onClose: () => {
            if (notifyNativeBnplClose('credit_direct')) {
                clearPaymentLaunch(paymentLaunchKeyRef);
                return;
            }

            window.setTimeout(() => {
                if (document.getElementById('klump_checkout')) {
                    return;
                }

                clearPaymentLaunch(paymentLaunchKeyRef);
                setStatus('error');
                setErrorMessage('Payment cancelled. Please try again.');
            }, 0);
        },
        onError: (error) => {
            clearCreditDirectPopupMarker(order.id);
            setCreditDirectPopupMarker(null);
            if (
                bridgeOpenedAttemptError({
                    providerOpenedLaunchKeyRef,
                    launchKey,
                    gateway: 'credit_direct',
                    orderId: order.id,
                    message: error,
                })
            ) {
                clearPaymentLaunch(paymentLaunchKeyRef);
                return;
            }
            clearPaymentLaunch(paymentLaunchKeyRef);
            console.error('Credit Direct Error:', error);
            setStatus('error');
            setErrorMessage(error);
        },
    });
}
