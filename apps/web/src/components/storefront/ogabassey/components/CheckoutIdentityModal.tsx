'use client';

import {
  User,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { CheckoutCodeSignin } from '@/components/storefront/checkout-code-signin';
import { useEffect, useState } from 'react';
import { buildCheckoutIdentityRoutes } from '@/components/storefront/checkout-route';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { cn } from '@/lib/utils';

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
  const [activeTab, setActiveTab] = useState<'new' | 'signin'>('new');

  const router = useRouter();
  const merchantContext = useMerchantSafe();
  const _merchant = merchantContext?.merchant;
  const { checkoutUrl: normalizedCheckoutUrl, signupUrl } =
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
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl animate-in slide-in-from-bottom-4 duration-300 sm:rounded-2xl sm:zoom-in-95">

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

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button type="button"
            onClick={() => setActiveTab('new')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3.5 font-bold text-sm transition-colors border-b-2",
              activeTab === 'new'
                ? "border-red-600 text-red-600 bg-red-50/50"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            )}
          >
            <UserPlus size={16} />
            New Customer
          </button>
          <button type="button"
            onClick={() => setActiveTab('signin')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3.5 font-bold text-sm transition-colors border-b-2",
              activeTab === 'signin'
                ? "border-red-600 text-red-600 bg-red-50/50"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            )}
          >
            <User size={16} />
            Sign In
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {activeTab === 'new' ? (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200">
              {/* Guest Checkout - Primary Option */}
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-red-200 transition-all">
                <h4 className="font-bold text-gray-900 mb-1 flex items-center gap-2">
                  <Zap size={16} className="text-amber-500 fill-amber-500" />
                  Guest Checkout
                </h4>
                <p className="text-xs text-gray-500 mb-4">
                  Fastest way to checkout. Create an account later if you wish.
                </p>
                <button type="button"
                  onClick={handleGuestCheckout}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 rounded-xl text-sm shadow-lg active:scale-[0.98] transition-all"
                >
                  Continue as Guest
                </button>
              </div>

              {/* Divider */}
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-3 text-gray-400 font-medium">or</span>
                </div>
              </div>

              {/* Create Account - Secondary Option */}
              <div className="p-4 bg-red-50/50 rounded-2xl border border-red-100 text-center">
                <h4 className="font-bold text-gray-900 mb-1 flex items-center justify-center gap-2">
                  <UserPlus size={16} className="text-red-600" />
                  Create Account
                </h4>
                <p className="text-xs text-gray-600 mb-4">
                  Save your details for faster checkout next time.
                </p>
                <button type="button"
                  onClick={() => router.push(signupUrl)}
                  className="w-full border-2 border-red-600 text-red-600 hover:bg-red-50 font-bold py-3.5 rounded-xl text-sm transition-all"
                >
                  Register Now
                </button>
              </div>
            </div>
          ) : (
            <CheckoutCodeSignin merchantSlug={_merchant?.slug ?? ''} onSuccess={() => { router.push(normalizedCheckoutUrl); onClose(); }} />
          )}
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
