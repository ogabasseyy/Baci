'use client';
import Link from 'next/link';
import { useCart } from '@/hooks/cart';
import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';

export default function Cart() {
  const { cart } = useCart();
  return (
    <main>
      <h1>Fixture cart</h1>
      {cart.map((item) => (
        <p key={item.cartItemId}>{item.name}</p>
      ))}
      <Link href="/checkout">Proceed to checkout</Link>
    </main>
  );
}
