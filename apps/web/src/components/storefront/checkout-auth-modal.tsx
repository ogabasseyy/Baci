'use client';

import { CheckoutCodeSignin } from '@/components/storefront/checkout-code-signin';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { notifyCheckoutAuthChanged } from './checkout-auth-notification';
import { supportsCheckoutSocialSignIn } from './ogabassey/components/checkout-social-support';

interface CheckoutAuthModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CheckoutAuthModal({
  isOpen,
  onOpenChange,
  onSuccess,
}: CheckoutAuthModalProps) {
  const slug = useMerchantSafe()?.merchant?.slug;
  const socialReturnTo =
    typeof window !== 'undefined' &&
    supportsCheckoutSocialSignIn(
      window.location.hostname,
      process.env.NODE_ENV === 'production'
    )
      ? `${window.location.pathname}${window.location.search}`
      : undefined;
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            Sign in to access your saved address and faster checkout.
          </DialogDescription>
        </DialogHeader>
        {slug ? (
          <CheckoutCodeSignin
            merchantSlug={slug}
            socialReturnTo={socialReturnTo}
            onSuccess={() => {
              notifyCheckoutAuthChanged();
              onSuccess();
              onOpenChange(false);
            }}
          />
        ) : (
          <p role="alert">
            Sign-in is temporarily unavailable. Please try again.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
