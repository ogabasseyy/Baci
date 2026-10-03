'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CartPageMobileCheckoutBar } from '@/components/storefront/ogabassey/pages/cart-page-mobile-checkout-bar';
import { CartPageSummaryPanel } from '@/components/storefront/ogabassey/pages/cart-page-summary-panel';
import { useCart } from '@/hooks/cart';
import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';

export default function Cart() {
  const router = useRouter();
  const { cart } = useCart();
  const [manualQa, setManualQa] = useState(false);
  useEffect(() => {
    setManualQa(
      new URLSearchParams(window.location.search).get('qa') === 'manual'
    );
    if (new URLSearchParams(window.location.search).get('qaReset') !== '1')
      return;
    const clearFixtureStorage = () => {
      localStorage.removeItem('baci-cart-ogabassey-guest');
      sessionStorage.removeItem('checkout-form');
      sessionStorage.removeItem('storefront-checkout-pending-order');
      localStorage.removeItem('storefront-checkout-idempotency');
    };
    clearFixtureStorage();
    window.setTimeout(clearFixtureStorage, 0);
    window.history.replaceState(null, '', '/cart?qa=manual');
  }, []);
  const onCheckoutClick = () => {
    router.push(manualQa ? '/checkout?qa=manual' : '/checkout');
  };
  return (
    <main>
      <h1>Fixture cart</h1>
      {cart.map((item) => (
        <p key={item.cartItemId}>{item.name}</p>
      ))}
      <CartPageSummaryPanel
        displayCartTotal={cart.reduce((total, item) => total + item.price, 0)}
        hasNonNegotiableCartItem={true}
        hasPriceNegotiation={false}
        onCheckoutClick={onCheckoutClick}
        onOpenTotalNegotiation={() => undefined}
      />
      <CartPageMobileCheckoutBar
        displayCartTotal={cart.reduce((total, item) => total + item.price, 0)}
        hasNonNegotiableCartItem={true}
        hasPriceNegotiation={false}
        onCheckoutClick={onCheckoutClick}
        onOpenTotalNegotiation={() => undefined}
      />
      <Link href={manualQa ? '/checkout?qa=manual' : '/checkout'}>
        Proceed to checkout
      </Link>
    </main>
  );
}
