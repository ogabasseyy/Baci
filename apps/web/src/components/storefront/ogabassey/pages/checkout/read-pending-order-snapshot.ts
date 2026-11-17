import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from './pending-checkout-order';

export function readPendingOrderSnapshot(orderId: string | null) {
    if (!orderId || typeof window === 'undefined') {
        return null;
    }

    try {
        const stored = window.sessionStorage.getItem(
            CHECKOUT_PENDING_ORDER_STORAGE_KEY
        );
        if (!stored) {
            return null;
        }

        const pendingOrder = JSON.parse(stored) as {
            orderId?: string;
            trackingToken?: string;
            customerEmail?: string;
            customerPhone?: string;
        };

        if (pendingOrder.orderId !== orderId) {
            return null;
        }

        return {
            trackingToken: pendingOrder.trackingToken || null,
            customerEmail: pendingOrder.customerEmail?.trim() || null,
            customerPhone: pendingOrder.customerPhone?.trim() || null,
        };
    } catch {
        return null;
    }
}
