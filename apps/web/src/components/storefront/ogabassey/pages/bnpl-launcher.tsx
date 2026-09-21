'use client';

import type { Route } from 'next';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import { openCreditDirectCheckout } from '@/lib/credit-direct-client';
import { openCredPalCheckout } from '@/lib/credpal';
import { apiPost } from '@/lib/api-client';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { useCartSafe } from '@/hooks/cart';
import {
    getKlumpConstructor,
    getKlumpPublicKey,
    loadKlumpSdk,
} from '@/lib/klump-sdk';
import {
    buildKlumpItems,
    getUnmaskedValue,
    normalizeKlumpPhone,
    toKlumpIntegerAmount,
    toCurrencyAmount,
    type BnplOrder,
} from '@/lib/klump-utils';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from './checkout/pending-checkout-order';
import {
    clearCreditDirectPopupMarker,
    type CreditDirectPopupMarker,
    readCreditDirectPopupMarker,
    writeCreditDirectPopupMarker,
} from './checkout/credit-direct-popup-return';
import { captureCreditDirectClientCompletion } from './checkout/credit-direct-client-completion';
import { useCreditDirectVerification } from './checkout/hooks/use-credit-direct-verification';
import { useCreditDirectConfirmationRedirect } from './checkout/hooks/use-credit-direct-confirmation-redirect';
import { CreditDirectVerificationView } from './checkout/components/CreditDirectVerificationView';
import { captureBnplPaymentCompleted } from './checkout/capture-bnpl-payment-completed';
import {
    bridgeOpenedAttemptError,
    notifyNativeBnplClose,
    notifyNativeBnplProviderOpened,
} from './checkout/native-bnpl-bridge';
import { captureKlumpCallbackSettlementIfPaid } from './checkout/klump-callback-settlement';
import {
    captureKlumpLauncherFailed,
    captureKlumpLauncherStarted,
} from './checkout/klump-launcher-attribution';

const KLUMP_TRANSACTION_ID_KEYS = [
    'klump_transaction_id',
    'klumpTransactionId',
    'checkout_transaction_id',
    'checkoutTransactionId',
    'transaction_id',
    'transactionId',
    'tx_ref',
    'txRef',
    'id',
] as const;

export const KLUMP_REDIRECT_URL_KEY = 'klump_redirect_url';

interface SearchParamReader {
    get: (name: string) => string | null;
}

interface KlumpRecordResponse {
    success?: boolean;
    error?: string;
}

function readSearchParam(
    searchParams: SearchParamReader,
    keys: readonly string[]
) {
    for (const key of keys) {
        const value = searchParams.get(key);
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return null;
}

function getKlumpTransactionId(searchParams: SearchParamReader) {
    return readSearchParam(searchParams, KLUMP_TRANSACTION_ID_KEYS);
}

function buildCurrentPathRedirectUrl(callbackQuery: URLSearchParams) {
    return `${window.location.origin}${window.location.pathname}?${callbackQuery.toString()}`;
}

// Slug-prefixed storefront contexts (localhost, previews, the root domain)
// serve the launcher at /{slug}/checkout/bnpl; an absolute /order-success
// would escape the storefront there. Preserve whatever prefix the launcher
// itself was served under.
function buildLauncherScopedPath(target: string) {
    if (typeof window === 'undefined') {
        return target;
    }
    const { pathname } = window.location;
    const anchorIndex = pathname.lastIndexOf('/checkout/bnpl');
    if (anchorIndex <= 0) {
        return target;
    }
    return `${pathname.slice(0, anchorIndex)}${target}`;
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

function readPendingOrderSnapshot(orderId: string | null) {
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

type BnplGateway = 'credit_direct' | 'credpal' | 'klump';

function tryStartPaymentLaunch(
    paymentLaunchKeyRef: { current: string | null },
    key: string
) {
    if (paymentLaunchKeyRef.current === key) {
        return false;
    }

    paymentLaunchKeyRef.current = key;
    return true;
}

function clearPaymentLaunch(paymentLaunchKeyRef: { current: string | null }) {
    paymentLaunchKeyRef.current = null;
}

interface BnplLaunchParams {
    orderId: string | null;
    gateway: BnplGateway | null;
    klumpCallback: boolean;
    klumpReference: string | null;
    klumpTransactionId: string | null;
    trackingToken: string | null;
    lookupEmail: string | null;
    lookupPhone: string | null;
    lookupCustomerName: string | null;
    merchantSlugParam: string | null;
    contextMerchantSlug: string | null;
    fallbackMerchantSlug: string;
    pendingOrderSnapshot: ReturnType<typeof readPendingOrderSnapshot>;
    paymentLaunchKeyRef: { current: string | null };
    providerOpenedLaunchKeyRef: { current: string | null };
    klumpSuccessRedirectRef: { current: boolean };
    router: ReturnType<typeof useRouter>;
    setStatus: (status: 'loading' | 'processing' | 'error') => void;
    setErrorMessage: (message: string | null) => void;
    setCreditDirectPopupMarker: (
        marker: CreditDirectPopupMarker | null
    ) => void;
}

// Hoisted to module scope: the throw-inside-try/catch statements and dynamic
// imports below would otherwise block React Compiler memoization of
// BnplLauncher (BuildHIR bailouts).
async function launchBnplPayment({
    orderId,
    gateway,
    klumpCallback,
    klumpReference,
    klumpTransactionId,
    trackingToken,
    lookupEmail,
    lookupPhone,
    lookupCustomerName,
    merchantSlugParam,
    contextMerchantSlug,
    fallbackMerchantSlug,
    pendingOrderSnapshot,
    paymentLaunchKeyRef,
    providerOpenedLaunchKeyRef,
    klumpSuccessRedirectRef,
    router,
    setStatus,
    setErrorMessage,
    setCreditDirectPopupMarker,
}: BnplLaunchParams) {
    try {
        if (!orderId || !gateway) {
            setStatus('error');
            setErrorMessage('Missing order ID or gateway information.');
            return;
        }

        setStatus('loading');
        setErrorMessage(null);

        if (gateway === 'klump' && klumpCallback) {
            if (!klumpReference || !trackingToken) {
                throw new Error('Missing Klump callback context.');
            }

            if (!klumpTransactionId) {
                throw new Error(
                    'Klump checkout returned without a transaction id.'
                );
            }

            if (
                !tryStartPaymentLaunch(
                    paymentLaunchKeyRef,
                    `klump-callback:${orderId}:${klumpReference}:${klumpTransactionId}:${trackingToken}`
                )
            ) {
                return;
            }

            const recordResponse = await apiPost<KlumpRecordResponse>(
                '/api/payments/klump/record',
                {
                    merchant_reference: klumpReference,
                    klump_transaction_id: klumpTransactionId,
                    tracking_token: trackingToken,
                }
            );

            if (!recordResponse?.success) {
                throw new Error(
                    recordResponse?.error ||
                        'Failed to record Klump transaction.'
                );
            }

            // Best-effort attribution detached from navigation: the record
            // call above already succeeded, and the helper never throws, so
            // a stalled settlement lookup must not delay the redirect —
            // the shopper proceeds while attribution lands independently.
            void captureKlumpCallbackSettlementIfPaid({
                orderId,
                klumpReference,
                trackingToken,
                merchantSlug:
                    merchantSlugParam ||
                    contextMerchantSlug ||
                    fallbackMerchantSlug,
            });

            const successQuery = new URLSearchParams({
                orderId,
                reference: klumpReference,
                type: 'klump',
            });
            successQuery.set('trackingToken', trackingToken);
            router.push(`/order-success?${successQuery.toString()}` as Route);
            return;
        }

        const slug =
            merchantSlugParam ||
            contextMerchantSlug ||
            fallbackMerchantSlug;
        const query = new URLSearchParams({ merchant_slug: slug });
        if (trackingToken) {
            query.set('token', trackingToken);
        }
        if (lookupEmail) {
            query.set('email', lookupEmail);
        }

        if (process.env.NODE_ENV === 'development') {
            console.log(
                `[BnplLauncher] Fetching order ${orderId} for merchant ${slug}`
            );
        }
        const url = `/api/storefront/orders/${orderId}?${query.toString()}`;
        const res = await fetch(url);

        if (!res.ok) {
            const errorText = await res.text();
            console.error(
                `[BnplLauncher] Fetch failed: ${res.status} ${errorText}`
            );
            throw new Error(
                `Failed to fetch order details (Status: ${res.status})`
            );
        }

        const order = (await res.json()) as BnplOrder;
        if (!order.items || order.items.length === 0) {
            throw new Error('Order has no items.');
        }

        const checkoutCustomerEmail = getUnmaskedValue(
            pendingOrderSnapshot?.customerEmail,
            lookupEmail,
            order.customer_email
        );
        const checkoutCustomerPhone = getUnmaskedValue(
            pendingOrderSnapshot?.customerPhone,
            lookupPhone,
            order.customer_phone
        );
        const checkoutCustomerName =
            lookupCustomerName || order.customer_name || '';

        setStatus('processing');

        if (gateway === 'credit_direct') {
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
            return;
        }

        if (gateway === 'credpal') {
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
            return;
        }

        if (gateway === 'klump') {
            if (!klumpReference || !trackingToken) {
                throw new Error(
                    'Missing Klump reference or tracking token.'
                );
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
            const phone = normalizeKlumpPhone(
                checkoutCustomerPhone
            );

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
            return;
        }

        throw new Error('Unsupported gateway for this launcher.');
    } catch (error) {
        console.error('BNPL Launch Error:', error);
        setStatus('error');
        setErrorMessage(
            error instanceof Error ? error.message : 'Failed to launch payment.'
        );
    }
}

interface BnplLauncherProps {
    merchantSlug?: string;
}

export function BnplLauncher({ merchantSlug = 'ogabassey' }: BnplLauncherProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const merchantContext = useMerchantSafe();
    const clearCart = useCartSafe()?.clearCart;

    const orderId = searchParams.get('orderId');
    const gateway = searchParams.get('gateway') as BnplGateway | null;
    const creditDirectCompletionReference =
        searchParams.get('creditDirectCompletion')?.trim() || null;
    const klumpReference = searchParams.get('reference')?.trim() || null;
    const klumpCallback = searchParams.get('klump_callback') === '1';
    const klumpTransactionId = getKlumpTransactionId(searchParams);
    const trackingTokenParam =
        searchParams.get('trackingToken') ||
        searchParams.get('tracking_token') ||
        searchParams.get('token');
    const pendingOrderSnapshot = readPendingOrderSnapshot(orderId);
    const trackingToken = trackingTokenParam || pendingOrderSnapshot?.trackingToken || null;
    const lookupEmail =
        searchParams.get('email')?.trim() ||
        pendingOrderSnapshot?.customerEmail ||
        null;
    const lookupPhone =
        searchParams.get('customerPhone')?.trim() ||
        searchParams.get('phone')?.trim() ||
        pendingOrderSnapshot?.customerPhone ||
        null;
    const lookupCustomerName =
        searchParams.get('customerName')?.trim() ||
        searchParams.get('name')?.trim() ||
        null;
    const merchantSlugParam =
        searchParams.get('merchant_slug') || searchParams.get('slug');

    const [status, setStatus] = useState<'loading' | 'processing' | 'error'>(
        'loading'
    );
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const paymentLaunchKeyRef = useRef<string | null>(null);
    const providerOpenedLaunchKeyRef = useRef<string | null>(null);
    const lastLaunchRequestKeyRef = useRef<string | null>(null);
    const klumpSuccessRedirectRef = useRef(false);
    const [creditDirectPopupMarker, setCreditDirectPopupMarker] =
        useState<CreditDirectPopupMarker | null>(null);

    const adoptCreditDirectPopupMarker = (marker: CreditDirectPopupMarker) => {
        setCreditDirectPopupMarker((current) =>
            current && current.transactionId === marker.transactionId
                ? current
                : marker
        );
    };

    const launchRequestKey = JSON.stringify([
        orderId,
        gateway,
        creditDirectCompletionReference,
        klumpCallback,
        klumpReference,
        klumpTransactionId,
        trackingToken,
        lookupEmail,
        lookupPhone,
        lookupCustomerName,
        merchantSlugParam,
        merchantContext?.merchant?.slug ?? null,
        merchantSlug,
    ]);

    // The Credit Direct popup can replace this document (mobile WebView) or
    // restore it from the back/forward cache. Both paths must resume as a
    // status verification instead of relaunching the SDK.
    useEffect(() => {
        if (gateway !== 'credit_direct' || klumpCallback) {
            return;
        }

        const handlePageShow = (event: PageTransitionEvent) => {
            if (!event.persisted) {
                return;
            }
            clearPaymentLaunch(paymentLaunchKeyRef);
            const marker = creditDirectCompletionReference
                ? {
                      source: 'sdk_success' as const,
                      transactionId: creditDirectCompletionReference,
                      storedAt: '',
                  }
                : readCreditDirectPopupMarker(orderId);
            if (marker) {
                adoptCreditDirectPopupMarker(marker);
            }
        };

        window.addEventListener('pageshow', handlePageShow);
        return () => window.removeEventListener('pageshow', handlePageShow);
    }, [creditDirectCompletionReference, gateway, klumpCallback, orderId]);

    useEffect(() => {
        // An error is terminal only for the launch request that produced it.
        // This prevents a same-request re-run from adopting a marker written
        // immediately before onError, while a new URL or explicit retry gets
        // a new request key and can launch without requiring a page reload.
        if (
            status === 'error' &&
            lastLaunchRequestKeyRef.current === launchRequestKey
        ) {
            return;
        }
        lastLaunchRequestKeyRef.current = launchRequestKey;
        if (gateway === 'credit_direct' && !klumpCallback) {
            if (creditDirectPopupMarker) {
                return;
            }
            const marker = creditDirectCompletionReference
                ? {
                      source: 'sdk_success' as const,
                      transactionId: creditDirectCompletionReference,
                      storedAt: '',
                  }
                : readCreditDirectPopupMarker(orderId);
            if (marker) {
                adoptCreditDirectPopupMarker(marker);
                return;
            }
        }

        void launchBnplPayment({
            orderId,
            gateway,
            klumpCallback,
            klumpReference,
            klumpTransactionId,
            trackingToken,
            lookupEmail,
            lookupPhone,
            lookupCustomerName,
            merchantSlugParam,
            contextMerchantSlug: merchantContext?.merchant?.slug ?? null,
            fallbackMerchantSlug: merchantSlug,
            pendingOrderSnapshot,
            paymentLaunchKeyRef,
            providerOpenedLaunchKeyRef,
            klumpSuccessRedirectRef,
            router,
            setStatus,
            setErrorMessage,
            setCreditDirectPopupMarker,
        });
    }, [
        orderId,
        gateway,
        merchantContext?.merchant?.slug,
        merchantSlug,
        merchantSlugParam,
        lookupEmail,
        lookupCustomerName,
        lookupPhone,
        klumpCallback,
        klumpReference,
        klumpTransactionId,
        router,
        trackingToken,
        creditDirectPopupMarker,
        creditDirectCompletionReference,
        launchRequestKey,
    ]);

    const creditDirectVerification = useCreditDirectVerification({
        active: Boolean(
            creditDirectPopupMarker &&
                orderId &&
                gateway === 'credit_direct' &&
                !klumpCallback
        ),
        orderId,
        merchantSlug:
            merchantSlugParam ||
            merchantContext?.merchant?.slug ||
            merchantSlug,
        trackingToken,
        lookupEmail,
    });

    useCreditDirectConfirmationRedirect({
        phase: creditDirectVerification.phase,
        marker: creditDirectPopupMarker,
        orderId,
        trackingToken,
        lookupEmail,
        confirmedTotal: creditDirectVerification.confirmedOrder?.total,
        confirmedCurrency: creditDirectVerification.confirmedOrder?.currency,
        orderSuccessBasePath: buildLauncherScopedPath('/order-success'),
        clearCart,
        router,
    });

    const retryCreditDirectPayment = () => {
        clearCreditDirectPopupMarker(orderId);
        clearPaymentLaunch(paymentLaunchKeyRef);
        setErrorMessage(null);
        setStatus('loading');
        setCreditDirectPopupMarker(null);
    };

    const shouldLoadKlumpScript = gateway === 'klump' && !klumpCallback;

    const verificationPhase = creditDirectVerification.phase;
    if (
        creditDirectPopupMarker &&
        (verificationPhase === 'polling' ||
            verificationPhase === 'timeout' ||
            verificationPhase === 'cancelled')
    ) {
        return (
            <CreditDirectVerificationView
                phase={verificationPhase}
                onKeepWaiting={creditDirectVerification.restart}
                onRetryPayment={
                    creditDirectPopupMarker.source === 'sdk_success'
                        ? undefined
                        : retryCreditDirectPayment
                }
                onReturnHome={() =>
                    router.push((buildLauncherScopedPath('') || '/') as Route)
                }
            />
        );
    }

    if (status === 'error') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                {shouldLoadKlumpScript && (
                    <div id="klump__checkout" className="hidden" aria-hidden="true" />
                )}
                <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8 text-center">
                    <div className="size-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="size-8 text-red-600" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">
                        Something went wrong
                    </h2>
                    <p className="text-gray-600 mb-6">{errorMessage}</p>
                    <button type="button"
                        onClick={() => {
                            // A cancelled/errored SDK attempt may have left a
                            // popup marker behind; clear it so the reload
                            // relaunches checkout instead of entering the
                            // verification flow.
                            clearCreditDirectPopupMarker(orderId);
                            window.location.reload();
                        }}
                        className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
                    >
                        Try Again
                    </button>
                    <button type="button"
                        onClick={() => router.push('/')}
                        className="w-full mt-3 py-3 text-gray-600 font-medium hover:text-gray-900 transition-colors"
                    >
                        Return to Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
            {shouldLoadKlumpScript && (
                <div id="klump__checkout" className="hidden" aria-hidden="true" />
            )}
            <div className="text-center">
                <div className="relative size-20 mx-auto mb-6">
                    <div className="absolute inset-0 border-4 border-gray-100 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-store-primary rounded-full border-t-transparent animate-spin"></div>
                    <ShieldCheck className="absolute inset-0 m-auto text-store-primary size-8" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                    Secure Checkout
                </h1>
                <p className="text-gray-500">Launching payment gateway…</p>
                <p className="text-xs text-gray-400 mt-8">
                    Please do not close this window.
                </p>
            </div>
        </div>
    );
}
