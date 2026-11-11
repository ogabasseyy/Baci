'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, ShieldCheck, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { CheckoutCodeSignin } from '@/components/storefront/checkout-code-signin';
import { buildCheckoutIdentityRoutes } from '@/components/storefront/checkout-route';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import styles from './CheckoutIdentityModal.module.css';
import { supportsCheckoutSocialSignIn } from './checkout-social-support';

interface CheckoutIdentityModalProps {
  isOpen: boolean;
  onClose: () => void;
  checkoutUrl: string;
  onProceed?: () => void;
}

/**
 * Ogabassey-styled Checkout Identity Modal
 * 2026 Best Practice: Native modal with brand-consistent design
 * - Body scroll lock when open
 * - z-100 to overlay bottom nav bar
 * Matches the UtilityModal and NegotiationModal styling patterns
 */
export function CheckoutIdentityModal({
  isOpen,
  onClose,
  checkoutUrl,
  onProceed,
}: CheckoutIdentityModalProps) {
  const router = useRouter();
  const merchantContext = useMerchantSafe();
  const _merchant = merchantContext?.merchant;
  const socialAvailable = typeof window !== 'undefined' && supportsCheckoutSocialSignIn(window.location.hostname, process.env.NODE_ENV === 'production');
  const { checkoutUrl: normalizedCheckoutUrl } =
    buildCheckoutIdentityRoutes(checkoutUrl);

  const handleGuestCheckout = () => {
    router.push(normalizedCheckoutUrl);
    onProceed?.();
    onClose();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
    <div className={`fixed inset-0 z-100 flex justify-center ${styles.overlay}`}>
      <Dialog.Overlay
        className="absolute inset-0 border-0 bg-black/50 p-0 backdrop-blur-xs animate-in fade-in duration-200"
      />
      <Dialog.Content className="relative z-10 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-store-border bg-[var(--store-surface,var(--store-background))] shadow-2xl animate-in slide-in-from-bottom-4 duration-300 sm:rounded-2xl sm:zoom-in-95">

        <div className="px-6 pt-6 sm:px-8 sm:pt-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-store-primary">Checkout</p>
              <Dialog.Title className="text-2xl font-bold tracking-tight text-store-background-text">Let’s get you started</Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-store-background-text/65">Sign in or create an account for a faster checkout.</Dialog.Description>
            </div>
            <button type="button" onClick={onClose} className="flex size-10 shrink-0 items-center justify-center rounded-full text-store-background-text/60 transition-colors hover:bg-store-background-text/5 hover:text-store-background-text" aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="space-y-5 px-6 pb-6 pt-6 sm:px-8">
          {_merchant?.slug ? (
            <CheckoutCodeSignin
              merchantSlug={_merchant.slug}
              onSuccess={handleGuestCheckout}
              socialReturnTo={socialAvailable ? String(normalizedCheckoutUrl) : undefined}
            />
          ) : (
            <p role="status">Sign-in is currently unavailable. You can continue as a guest.</p>
          )}
          <button
            type="button"
            onClick={handleGuestCheckout}
            className="group flex min-h-11 w-full items-center justify-center gap-2 text-sm font-semibold text-store-background-text/70 transition-colors hover:text-store-primary"
          >
            Continue as Guest
            <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 border-t border-store-border px-6 py-4 text-xs text-store-background-text/55">
          <ShieldCheck aria-hidden="true" className="size-4 text-store-primary" />
          Secure checkout
        </div>
      </Dialog.Content>
    </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
