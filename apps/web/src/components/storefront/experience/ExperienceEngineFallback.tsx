'use client';

import type { PublicBootstrap } from '@baci/shared/experience';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useCartSafe } from '@/hooks/cart/cart-context';
import { fetchSharedCartProducts } from '@/hooks/cart/shared-cart-products';
import { asRoute } from '@/lib/routes';
/** Authoritative current catalog with the native cart; never authored source HTML. */
export function ExperienceEngineFallback({
  bootstrap,
  title,
  merchantId,
  canonicalBase,
}: {
  bootstrap: PublicBootstrap;
  title: string;
  merchantId: string;
  canonicalBase: string;
}) {
  const cart = useCartSafe();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const base = new URL(canonicalBase).pathname.replace(/\/$/, '');
  const currency =
    bootstrap.currency ?? bootstrap.catalog.products[0]?.currency ?? 'NGN';
  return (
    <main>
      <h1>{title}</h1>
      <p>Continue with the Baci storefront.</p>
      {bootstrap.catalog.products.map((p) => (
        <article key={p.id}>
          <h2>
            <Link
              href={asRoute(base + (p.canonicalPath ?? `/products/${p.slug}`))}
            >
              {p.name}
            </Link>
          </h2>
          {p.image && bootstrap.assets?.[p.image.assetId] && (
            <Image
              unoptimized
              src={bootstrap.assets[p.image.assetId]}
              alt={p.image.alt}
              width={160}
              height={160}
            />
          )}
          <p>
            {p.currency} {p.price.toFixed(2)} ·{' '}
            {p.available === false ? 'Unavailable' : 'Available'}
          </p>
          {p.requiresVariant && (
            <label>
              Choose option
              <select
                value={selected[p.id] ?? ''}
                onChange={(e) =>
                  setSelected({ ...selected, [p.id]: e.currentTarget.value })
                }
              >
                <option value="">Choose an option</option>
                {p.variants.map((v) => (
                  <option key={v.id} value={v.id} disabled={!v.available}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {bootstrap.capabilities.includes('cart.mutate') &&
            cart?.experienceCommandPort && (
              <button
                type="button"
                disabled={
                  p.available === false ||
                  (p.requiresVariant && !selected[p.id])
                }
                onClick={() => {
                  void fetchSharedCartProducts([p.id], merchantId)
                    .then((products) => {
                      const product = products.get(p.id);
                      if (!product) {
                        setMessage(
                          'Product unavailable. Refresh the storefront.'
                        );
                        return;
                      }
                      const outcome = cart.addToCart(
                        product,
                        1,
                        selected[p.id]
                          ? { variantId: selected[p.id] }
                          : undefined
                      );
                      setMessage(
                        outcome === 'applied'
                          ? 'Added using Baci cart.'
                          : 'Unable to add using Baci cart.'
                      );
                    })
                    .catch(() => {
                      setMessage(
                        'Could not load this product. Refresh the storefront and try again.'
                      );
                    });
                }}
              >
                Add {p.name}
              </button>
            )}
        </article>
      ))}
      <p role="status">{message}</p>
      <p>
        Cart: {currency} {(cart?.cartTotal ?? 0).toFixed(2)}
      </p>
      <Link href={asRoute(`${base}/checkout`)}>Continue to checkout</Link>
    </main>
  );
}
