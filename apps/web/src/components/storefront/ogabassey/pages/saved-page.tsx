'use client';
// Migrated from temp-source/components/SavedPage.tsx
import { Heart, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import { EmptyState } from '../components/empty-state';
import { useV2Saved } from '../providers/v2-saved-context';

export const SavedPage: React.FC = () => {
  const { addToCart } = useCart();
  const { savedItems, toggleSaved } = useV2Saved();
  const router = useRouter();
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath || '';
  const getHref = (path: string) => path.startsWith('http') ? path : `${basePath}${path}`;

  return (
    <div className="min-h-screen bg-white pb-24 pt-4 flex flex-col">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full flex-1 flex flex-col">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2 shrink-0">
          <Heart className="text-red-600 fill-red-600" />
          Saved Items
        </h1>

        {savedItems.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              variant="saved"
              title="No saved items yet"
              description="Tap the heart icon on products you like to add them to your wishlist for later."
              actionLabel="Start Shopping"
              actionLink={getHref('/')}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {savedItems.map((product) => (
              <div
                key={product.id}
                className="bg-white border border-gray-100 rounded-2xl p-3 md:p-4 shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col relative"
              >
                <Link
                  href={asRoute(
                    getStorefrontProductHref(product, basePath)
                  )}
                  className="absolute inset-0 z-0"
                />

                <div className="ogabassey-product-card-image-surface relative aspect-square mb-3 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden z-10 pointer-events-none">
                  <img
                    src={product.image}
                    alt={product.name}
                    className="w-3/4 h-3/4 object-contain mix-blend-multiply"
                  />
                </div>

                <div className="flex flex-col flex-1 pointer-events-none">
                  <h3 className="font-bold text-gray-900 mb-1 truncate text-sm md:text-base">
                    {product.name}
                  </h3>
                  <p className="text-gray-500 text-xs mb-3 line-clamp-2 hidden md:block">
                    {product.description}
                  </p>

                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-red-600 font-bold text-sm md:text-lg">
                      {product.price}
                    </span>
                  </div>
                </div>

                <div className="mt-3 z-20 flex gap-2">
                  <button type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      if (addToCart(product as any, 1) === 'rejected') {
                        return;
                      }
                      router.push(asRoute(getHref('/cart')));
                    }}
                    className="flex-1 bg-gray-900 text-white text-[10px] md:text-xs font-bold py-2 md:py-2.5 rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ShoppingCart size={14} /> Add
                  </button>
                  <button type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      toggleSaved(product);
                    }}
                    className="p-2 border border-gray-200 rounded-lg hover:border-red-200 hover:bg-red-50 text-red-600 transition-colors flex items-center justify-center"
                  >
                    <Heart size={16} className="fill-current" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
