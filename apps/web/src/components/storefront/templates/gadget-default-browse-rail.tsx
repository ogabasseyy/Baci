'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { IndustryTheme } from '@/hooks/use-industry-theme';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';

export type BrowseMode = 'category' | 'brand' | 'price';

const PRICE_RANGES = [
  { label: 'Under ₦5,000', href: '/search?max_price=5000' },
  {
    label: '₦5,000 - ₦20,000',
    href: '/search?min_price=5000&max_price=20000',
  },
  {
    label: '₦20,000 - ₦50,000',
    href: '/search?min_price=20000&max_price=50000',
  },
  { label: 'Over ₦50,000', href: '/search?min_price=50000' },
];

export interface GadgetDefaultBrowseRailProps {
  products?: Array<{ brand?: string | null }>;
  basePath?: string | null;
  theme: IndustryTheme;
  radiusClass: string;
}

export function GadgetDefaultBrowseRail({
  products = [],
  basePath,
  theme,
  radiusClass,
}: GadgetDefaultBrowseRailProps) {
  const [browseMode, setBrowseMode] = useState<BrowseMode>('category');
  const isDark = theme.id === 'hair-extensions';
  const borderClass = isDark ? 'border-zinc-800' : 'border-gray-200';

  const brands = new Set<string>();
  for (const product of products) {
    if (product.brand) {
      brands.add(product.brand);
    }
  }
  const allBrands = Array.from(brands).slice(0, 8);

  const categories = [
    {
      label: 'New Arrivals',
      icon: theme.icons.primary,
      href: '/new-arrivals',
    },
    {
      label: 'Best Sellers',
      icon: theme.icons.secondary,
      href: '/best-sellers',
    },
    { label: 'On Sale', icon: theme.icons.tertiary, href: '/on-sale' },
    {
      label: 'Featured',
      icon: theme.icons.primary,
      href: '/featured',
    },
  ];

  const getFullHref = (path: string) =>
    `${basePath || ''}${path === '/' ? '' : path}`;

  return (
    <section className="py-12 container mx-auto px-4">
      <div className="flex items-center gap-2 mb-8">
        <h2
          className="text-2xl font-bold"
          style={{ color: theme.colors.primary }}
        >
          Shop by
        </h2>
        <Select
          value={browseMode}
          onValueChange={(v) => setBrowseMode(v as BrowseMode)}
        >
          <SelectTrigger
            aria-label="Shop by"
            className="w-[180px] text-2xl font-bold border-none shadow-none focus:ring-0 px-0 h-auto"
            style={{ color: theme.colors.accent }}
          >
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="category">Category</SelectItem>
            <SelectItem value="brand">Brand</SelectItem>
            <SelectItem value="price">Price</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {browseMode === 'category' &&
          categories.map((cat) => (
            <Link
              key={cat.href}
              href={asRoute(getFullHref(cat.href))}
              className={cn(
                'group flex flex-col items-center justify-center p-6 transition-all hover:shadow-lg border',
                borderClass,
                radiusClass,
                theme.layout.categoryRail === 'circle' &&
                  'aspect-square rounded-full',
                theme.layout.categoryRail === 'pill' && 'aspect-2/1',
                theme.layout.categoryRail === 'square' && 'aspect-square',
                theme.layout.categoryRail === 'card' && 'aspect-4/3'
              )}
              style={{
                backgroundColor: theme.colors.card,
              }}
            >
              <cat.icon
                className="size-8 mb-3 transition-transform group-hover:scale-110"
                style={{ color: theme.colors.accent }}
              />
              <span className="font-medium text-center">{cat.label}</span>
            </Link>
          ))}

        {browseMode === 'brand' &&
          (allBrands.length > 0 ? (
            allBrands.map((brand) => (
              <Link
                key={brand}
                href={asRoute(
                  getFullHref(`/search?q=${encodeURIComponent(brand)}`)
                )}
                rel="nofollow"
                className={cn(
                  'group flex flex-col items-center justify-center p-6 transition-all hover:shadow-lg border',
                  borderClass,
                  radiusClass,
                  'aspect-4/3'
                )}
                style={{
                  backgroundColor: theme.colors.card,
                }}
              >
                <span
                  className="text-lg font-bold transition-transform group-hover:scale-110"
                  style={{ color: theme.colors.primary }}
                >
                  {brand}
                </span>
              </Link>
            ))
          ) : (
            <div className="col-span-4 text-center py-8 text-muted-foreground">
              No brands found.
            </div>
          ))}

        {browseMode === 'price' &&
          PRICE_RANGES.map((range) => (
            <Link
              key={range.href}
              href={asRoute(getFullHref(range.href))}
              rel="nofollow"
              className={cn(
                'group flex flex-col items-center justify-center p-6 transition-all hover:shadow-lg border',
                borderClass,
                radiusClass,
                'aspect-4/3'
              )}
              style={{
                backgroundColor: theme.colors.card,
              }}
            >
              <span
                className="text-lg font-bold transition-transform group-hover:scale-110"
                style={{ color: theme.colors.accent }}
              >
                {range.label}
              </span>
            </Link>
          ))}
      </div>
    </section>
  );
}
