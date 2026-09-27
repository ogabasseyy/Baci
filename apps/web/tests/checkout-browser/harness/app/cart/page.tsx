'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCart } from '@/hooks/cart';
import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';

export default function Cart() {
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
  return (
    <main>
      <h1>Fixture cart</h1>
      {cart.map((item) => (
        <p key={item.cartItemId}>{item.name}</p>
      ))}
      <Link href={manualQa ? '/checkout?qa=manual' : '/checkout'}>
        Proceed to checkout
      </Link>
    </main>
  );
}
