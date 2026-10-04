import {
    getKlumpConstructor,
    getKlumpPublicKey,
    loadKlumpSdk,
} from '@/lib/klump-sdk';
import {
    buildKlumpItems,
    normalizeKlumpPhone,
    toKlumpIntegerAmount,
} from '@/lib/klump-utils';
import {
    bridgeOpenedAttemptError,
    notifyNativeBnplClose,
    notifyNativeBnplProviderOpened,
} from './native-bnpl-bridge';
import {
    captureKlumpLauncherFailed,
    captureKlumpLauncherStarted,
} from './klump-launcher-attribution';
import type { BnplLaunchOrderContext } from './bnpl-launch-context';
import {
    clearPaymentLaunch,
    tryStartPaymentLaunch,
} from './bnpl-launch-keys';

export const KLUMP_REDIRECT_URL_KEY = 'klump_redirect_url';

function buildCurrentPathRedirectUrl(callbackQuery: URLSearchParams) {
    return `${window.location.origin}${window.location.pathname}?${callbackQuery.toString()}`;
}

function clearPendingKlumpRedirect() {
    try {
        window.localStorage.removeItem(KLUMP_REDIRECT_URL_KEY);
    } catch {
        // Ignore storage access failures.
    }
}

function clearPendingKlumpRedirectSoon() {
    window.setTimeout(clearPendingKlumpRedirect, 0);
}

function hasPendingKlumpRedirect(expectedRedirectUrl: string) {
    try {
        const storedRedirectUrl = window.localStorage.getItem(KLUMP_REDIRECT_URL_KEY);
        if (!storedRedirectUrl) {
            return false;
        }

        if (storedRedirectUrl === expectedRedirectUrl) {
            clearPendingKlumpRedirectSoon();
            return true;
        }

        clearPendingKlumpRedirect();
        return false;
    } catch {
        return false;
    }
}

/**
 * Klump launch branch: opens the provider widget for a validated integer
 * total, confirms the provider flow to the native host (and records the
 * deferred web start) on open, and records a web failure for an
 * opened-then-failed attempt so the onOpen start never strands unmatched.
 * Pre-open errors have no start and stay local.
 */
export async function launchKlumpCheckout({
    order,
    slug,
    trackingToken,
    lookupEmail,
    checkoutCustomerEmail,
    checkoutCustomerPhone,
    checkoutCustomerName,
    klumpReference,
    paymentLaunchKeyRef,
    providerOpenedLaunchKeyRef,
    klumpSuccessRedirectRef,
    setStatus,
    setErrorMessage,
}: BnplLaunchOrderContext): Promise<void> {
    if (!klumpReference || !trackingToken) {
        throw new Error('Missing Klump reference or tracking token.');
    }

    const klumpAmount = toKlumpIntegerAmount(order.total);
    if (klumpAmount <= 0) {
        setStatus('error');
        setErrorMessage('Invalid order total for Klump checkout.');
        return;
    }

    await loadKlumpSdk();
    const KlumpCheckout = getKlumpConstructor();
    if (!KlumpCheckout) {
        throw new Error('Klump SDK failed to load');
    }

    const publicKey = getKlumpPublicKey();
    const callbackQuery = new URLSearchParams({
        gateway: 'klump',
        klump_callback: '1',
        merchant_slug: slug,
        orderId: order.id,
        reference: klumpReference,
        type: 'klump',
    });
    callbackQuery.set('trackingToken', trackingToken);
    if (lookupEmail) {
        callbackQuery.set('email', lookupEmail);
    }

    const [first_name, ...rest] = (checkoutCustomerName || '')
        .trim()
        .split(/\s+/);
    const last_name = rest.join(' ');
    const phone = normalizeKlumpPhone(checkoutCustomerPhone);

    const launchKey = `klump:${order.id}:${klumpReference}:${trackingToken}`;
    if (!tryStartPaymentLaunch(paymentLaunchKeyRef, launchKey)) {
        return;
    }
    // New attempt: a later SDK error bridges to native only once
    // onOpen proves this attempt's provider flow opened.
    providerOpenedLaunchKeyRef.current = null;
    clearPendingKlumpRedirect();
    klumpSuccessRedirectRef.current = false;

    const klumpRedirectUrl = buildCurrentPathRedirectUrl(callbackQuery);

    new KlumpCheckout({
        publicKey,
        data: {
            amount: klumpAmount,
            currency: 'NGN',
            ...(checkoutCustomerEmail ? { email: checkoutCustomerEmail } : {}),
            ...(first_name ? { first_name } : {}),
            ...(last_name ? { last_name } : {}),
            ...(phone ? { phone } : {}),
            merchant_reference: klumpReference,
            redirect_url: klumpRedirectUrl,
            items: buildKlumpItems(order),
            meta_data: {
                order_id: order.id,
                source: 'baci-web',
            },
        },
        onClose: () => {
            window.setTimeout(() => {
                if (
                    klumpSuccessRedirectRef.current ||
                    hasPendingKlumpRedirect(klumpRedirectUrl) ||
                    document.getElementById('klump_checkout')
                ) {
                    return;
                }

                if (notifyNativeBnplClose('klump')) {
                    clearPaymentLaunch(paymentLaunchKeyRef);
                    return;
                }

                clearPaymentLaunch(paymentLaunchKeyRef);
                setStatus('error');
                setErrorMessage('Payment cancelled. Please try again.');
            }, 0);
        },
        onLoad: () => undefined,
        onOpen: () => {
            // The Klump widget opened: confirm the provider flow to
            // native so the start is recorded only for opened
            // checkouts. Browser sessions record the deferred web
            // start here instead (the helper no-ops natively).
            providerOpenedLaunchKeyRef.current = launchKey;
            notifyNativeBnplProviderOpened(
                'klump',
                order.id,
                klumpReference ?? undefined
            );
            captureKlumpLauncherStarted({
                order,
                reference: klumpReference ?? undefined,
            });
        },
        onSuccess: () => {
            klumpSuccessRedirectRef.current = true;
        },
        onError: (error) => {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Klump checkout failed.';
            if (
                bridgeOpenedAttemptError({
                    providerOpenedLaunchKeyRef,
                    launchKey,
                    gateway: 'klump',
                    orderId: order.id,
                    message,
                    reference: klumpReference ?? undefined,
                })
            ) {
                clearPaymentLaunch(paymentLaunchKeyRef);
                return;
            }
            // Browser sessions have no native shell to attribute
            // the failure, and checkout already navigated away: an
            // opened-then-failed attempt must record its web
            // failure here or the onOpen start strands unmatched.
            // Pre-open errors have no start and stay local.
            if (providerOpenedLaunchKeyRef.current === launchKey) {
                captureKlumpLauncherFailed({
                    order,
                    reference: klumpReference ?? undefined,
                });
            }
            clearPaymentLaunch(paymentLaunchKeyRef);
            setStatus('error');
            setErrorMessage(message);
        },
    });
}
