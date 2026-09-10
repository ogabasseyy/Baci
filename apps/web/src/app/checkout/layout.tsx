import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppSansFont } from '@/app/app-sans-font';
import '@/app/globals.css';
import { CartProvider } from '@/hooks/use-cart';

export const metadata: Metadata = {
  title: 'Secure Checkout | Baci',
  description:
    'Complete your purchase securely. Fast and safe checkout process powered by Baci.',
  robots: {
    index: false, // Don't index checkout pages
    follow: false,
  },
};

export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return (
    <AppSansFont>
      <CartProvider>{children}</CartProvider>
    </AppSansFont>
  );
}
