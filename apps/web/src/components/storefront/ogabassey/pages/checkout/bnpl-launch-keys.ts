/**
 * Single-flight guard for BNPL launch attempts: opening the same provider
 * twice for one order (StrictMode re-run, double submit, bfcache resume)
 * must not create a second checkout session.
 */
export function tryStartPaymentLaunch(
    paymentLaunchKeyRef: { current: string | null },
    key: string
) {
    if (paymentLaunchKeyRef.current === key) {
        return false;
    }

    paymentLaunchKeyRef.current = key;
    return true;
}

export function clearPaymentLaunch(paymentLaunchKeyRef: {
    current: string | null;
}) {
    paymentLaunchKeyRef.current = null;
}
