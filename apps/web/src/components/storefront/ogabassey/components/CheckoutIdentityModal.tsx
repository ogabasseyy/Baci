'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { CheckoutCodeSignin } from '@/components/storefront/checkout-code-signin';
import { useEffect } from 'react';
import { buildCheckoutIdentityRoutes } from '@/components/storefront/checkout-route';
import { useMerchantSafe } from '@/hooks/use-merchant-client';

interface CheckoutIdentityModalProps {
  isOpen: boolean;
  onClose: () => void;
  checkoutUrl: string;
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
}: CheckoutIdentityModalProps) {
  const router = useRouter();
  const merchantContext = useMerchantSafe();
  const _merchant = merchantContext?.merchant;
  const { checkoutUrl: normalizedCheckoutUrl } =
    buildCheckoutIdentityRoutes(checkoutUrl);

  // 2026 Best Practice: Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      // Store current scroll position and lock body
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';

      return () => {
        // Restore scroll position when modal closes
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleGuestCheckout = () => {
    router.push(normalizedCheckoutUrl);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-100 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Dismiss checkout modal backdrop"
        tabIndex={-1}
        className="absolute inset-0 border-0 bg-black/50 p-0 backdrop-blur-xs animate-in fade-in duration-200"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-2xl animate-in slide-in-from-bottom-4 duration-300 sm:rounded-2xl sm:zoom-in-95">

        {/* Header */}
        <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-b border-gray-100">
          <h3 className="font-bold text-lg text-gray-900">Checkout</h3>
          <button type="button"
            onClick={onClose}
            className="size-8 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5 p-6">
          <CheckoutCodeSignin
            merchantSlug={_merchant?.slug ?? ''}
            onSuccess={handleGuestCheckout}
            socialReturnTo={normalizedCheckoutUrl}
          />
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="h-px flex-1 bg-gray-200" />
            or
            <span className="h-px flex-1 bg-gray-200" />
          </div>
          <button
            type="button"
            onClick={handleGuestCheckout}
            className="w-full rounded-xl border border-gray-300 py-3 font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-200"
          >
            Continue as Guest
          </button>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-3 text-center border-t border-gray-100">
          <p className="text-[10px] text-gray-400 font-medium">
            🔒 Your security is our priority. All transactions are encrypted.
          </p>
        </div>
      </div>
    </div>
  );
}
