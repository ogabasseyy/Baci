import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from './pending-checkout-order';

/** A non-empty string, trimmed; anything else (objects, numbers) counts as absent. */
function text(value: unknown): string | null {
    return typeof value === 'string' ? value.trim() || null : null;
}

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

        const pendingOrder: unknown = JSON.parse(stored);
        if (typeof pendingOrder !== 'object' || pendingOrder === null) {
            return null;
        }
        const record = pendingOrder as Record<string, unknown>;

        if (record.orderId !== orderId) {
            return null;
        }

        return {
            trackingToken: text(record.trackingToken),
            customerEmail: text(record.customerEmail),
            customerPhone: text(record.customerPhone),
        };
    } catch {
        return null;
    }
}
