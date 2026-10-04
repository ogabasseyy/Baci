'use client';
import Link from 'next/link';
import { useCart } from '@/hooks/cart';
import '@/app/(storefront)/storefront-utility.css';
import { cartItem } from '../../../fixtures';

export default function Catalog() {
  const { addToCart, cartCount } = useCart();
  return (
    <main>
      <h1>Fixture catalog</h1>
      <button type="button" onClick={() => addToCart(cartItem)}>
        Add test phone
      </button>
      <Link href="/cart">View cart ({cartCount})</Link>
    </main>
  );
}
