import type { useRouter } from 'next/navigation';
import type { BnplOrder } from '@/lib/klump-utils';
import type { CreditDirectPopupMarker } from './credit-direct-popup-return';

export type BnplLaunchStatus = 'loading' | 'processing' | 'error';

/**
 * Host-provided controls shared by every provider launch branch: attempt
 * refs, navigation, and the status setters owned by the launcher.
 */
export interface BnplLaunchControls {
    paymentLaunchKeyRef: { current: string | null };
    providerOpenedLaunchKeyRef: { current: string | null };
    klumpSuccessRedirectRef: { current: boolean };
    router: ReturnType<typeof useRouter>;
    setStatus: (status: BnplLaunchStatus) => void;
    setErrorMessage: (message: string | null) => void;
    setCreditDirectPopupMarker: (
        marker: CreditDirectPopupMarker | null
    ) => void;
}

/**
 * Resolved launch context for one provider attempt: the fetched order,
 * the merchant slug, the unmasked checkout identity, and the provider
 * callback context. Each provider branch takes exactly this shape.
 */
export interface BnplLaunchOrderContext extends BnplLaunchControls {
    order: BnplOrder;
    slug: string;
    trackingToken: string | null;
    lookupEmail: string | null;
    checkoutCustomerEmail: string | null | undefined;
    checkoutCustomerPhone: string | null | undefined;
    checkoutCustomerName: string;
    klumpReference: string | null;
}
