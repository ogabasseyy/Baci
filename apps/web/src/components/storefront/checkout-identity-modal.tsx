'use client';

import { UserPlus, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckoutCodeSignin } from '@/components/storefront/checkout-code-signin';
import { buildCheckoutIdentityRoutes } from '@/components/storefront/checkout-route';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMerchantSafe } from '@/hooks/use-merchant-client';

interface CheckoutIdentityModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  checkoutUrl: string;
}

export function CheckoutIdentityModal({
  isOpen,
  onOpenChange,
  checkoutUrl,
}: CheckoutIdentityModalProps) {
  const [_activeTab, setActiveTab] = useState<'signin' | 'new'>('new');

  const router = useRouter();
  const merchantContext = useMerchantSafe();
  const _merchant = merchantContext?.merchant;
  const { checkoutUrl: normalizedCheckoutUrl, signupUrl } =
    buildCheckoutIdentityRoutes(checkoutUrl);

  const handleGuestCheckout = () => {
    router.push(normalizedCheckoutUrl);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px] p-0 overflow-hidden border-none rounded-2xl">
        <div
          className="h-2 w-full"
          style={{ backgroundColor: 'var(--store-primary, #ef4444)' }}
        />

        <div className="p-6">
          <DialogHeader className="mb-6">
            <DialogTitle className="text-2xl font-bold text-center">
              Checkout
            </DialogTitle>
            <DialogDescription className="text-center">
              Choose how you'd like to proceed with your order
            </DialogDescription>
          </DialogHeader>

          <Tabs
            defaultValue="new"
            onValueChange={(v) => setActiveTab(v as 'signin' | 'new')}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 mb-8 bg-gray-100/80 p-1 rounded-xl">
              <TabsTrigger
                value="new"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm py-2.5 font-bold"
              >
                New Customer
              </TabsTrigger>
              <TabsTrigger
                value="signin"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm py-2.5 font-bold"
              >
                Sign In
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="new"
              className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-store-primary/30 transition-all">
                  <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2">
                    <Zap size={16} className="text-amber-500 fill-amber-500" />
                    Guest Checkout
                  </h3>
                  <p className="text-xs text-gray-500 mb-4">
                    Fastest way to checkout. You can create an account after
                    your order is placed.
                  </p>
                  <Button
                    onClick={handleGuestCheckout}
                    className="w-full bg-black hover:bg-gray-900 text-white font-bold py-6 rounded-xl text-base shadow-lg active:scale-[0.98] transition-all"
                  >
                    Continue as Guest
                  </Button>
                </div>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-gray-100" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-gray-400 font-medium">
                      or
                    </span>
                  </div>
                </div>

                <div className="p-4 bg-store-primary/5 rounded-2xl border border-store-primary/10 text-center">
                  <h3 className="font-bold text-gray-900 mb-1 flex items-center justify-center gap-2">
                    <UserPlus size={16} className="text-store-primary" />
                    Create Account
                  </h3>
                  <p className="text-xs text-gray-600 mb-4">
                    Save your details for 1-click checkout next time.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => router.push(signupUrl)}
                    className="w-full border-store-primary text-store-primary hover:bg-store-primary/10 font-bold py-6 rounded-xl transition-all"
                  >
                    Register Now
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent
              value="signin"
              className="animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <CheckoutCodeSignin
                merchantSlug={_merchant?.slug ?? ''}
                onSuccess={() => {
                  router.push(normalizedCheckoutUrl);
                  onOpenChange(false);
                }}
              />
            </TabsContent>
          </Tabs>
        </div>

        <div className="bg-gray-50 p-4 text-center">
          <p className="text-[10px] text-gray-400 font-medium">
            Your security is our priority. All transactions are encrypted.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
