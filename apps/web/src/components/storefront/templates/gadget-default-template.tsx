'use client';

import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { AnnouncementBar } from '@/components/storefront/blocks/announcement-bar';
import { Footer } from '@/components/storefront/blocks/footer';
import { Header } from '@/components/storefront/blocks/header';
import { Newsletter } from '@/components/storefront/blocks/newsletter';
import { StorefrontProductGrid } from '@/components/storefront/product-grid';
import { ThemedButton } from '@/components/themed';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useIndustryTheme } from '@/hooks/use-industry-theme';
import { useMerchant } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';

import type { TemplatePageProps } from '@/templates/registry';

export function GadgetDefaultTemplate({
  isPreview,
  products = [],
}: TemplatePageProps) {
  const { merchant, basePath } = useMerchant();
  const theme = useIndustryTheme(merchant?.business_type);

  type BrowseMode = 'category' | 'brand' | 'price';
  const [browseMode, setBrowseMode] = useState<BrowseMode>('category');

  // Derive unique brands from products
  const brands = new Set<string>();
  products.forEach((p) => {
    if (p.brand) brands.add(p.brand);
  });
  const allBrands = Array.from(brands).slice(0, 8); // Limit to 8

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

  // --- Dynamic Assets ---
  const getHeroImage = () => {
    switch (merchant?.business_type) {
      case 'ELECTRONICS':
        return 'https://images.unsplash.com/photo-1498049794561-7780e7231661?q=80&w=2070&auto=format&fit=crop';
      case 'FOOD_BEVERAGE':
        return 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=2070&auto=format&fit=crop';
      case 'FASHION':
        return 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?q=80&w=2070&auto=format&fit=crop';
      case 'HOME_GOODS':
        return 'https://images.unsplash.com/photo-1513584684374-8bdb74838a0f?q=80&w=2070&auto=format&fit=crop';
      case 'HEALTH_BEAUTY':
        return 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?q=80&w=2070&auto=format&fit=crop';
      case 'HAIR_EXTENSIONS':
        return 'https://images.unsplash.com/photo-1522337621169-d6cf09e65d95?q=80&w=2044&auto=format&fit=crop';
      default:
        return 'https://images.unsplash.com/photo-1498049794561-7780e7231661?q=80&w=2070&auto=format&fit=crop';
    }
  };

  const heroImage = getHeroImage();

  // --- Dynamic Categories ---
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

  const getFullHref = (path: string) => {
    return `${basePath || ''}${path === '/' ? '' : path}`;
  };

  // --- Render Helpers ---
  const RadiusMap = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
    '3xl': 'rounded-3xl',
    full: 'rounded-full',
  };

  const radiusClass =
    RadiusMap[theme.radius as keyof typeof RadiusMap] || 'rounded-md';

  return (
    <div
      className="min-h-screen font-sans transition-colors duration-300"
      style={
        {
          backgroundColor: theme.colors.background,
          color: theme.colors.text,
          '--store-primary': theme.colors.primary,
          '--store-primary-text': '#FFFFFF',
          '--store-background': theme.colors.background,
          '--store-background-text': theme.colors.text,
          '--store-accent': theme.colors.accent,
          '--store-accent-text': '#FFFFFF',
        } as React.CSSProperties
      }
    >
      <AnnouncementBar />
      <Header
        showLogo={true}
        showSearch={true}
        showCart={true}
        showMenu={true}
        layout="logo-left-nav-center"
        sticky={true}
        isPreview={isPreview}
      />

      <main>
        {/* --- Dynamic Hero Section --- */}
        <section className="relative overflow-hidden">
          {theme.layout.hero === 'full' ? (
            <div className="relative h-[600px] w-full">
              <Image
                src={heroImage}
                alt="Hero"
                fill
                sizes="100vw"
                className="object-cover"
                priority
              />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-center p-6">
                <div className="max-w-2xl text-white space-y-6">
                  <h1 className="text-5xl md:text-7xl font-bold tracking-tight">
                    {merchant?.business_name || 'Welcome to Store'}
                  </h1>
                  <p className="text-xl md:text-2xl font-light opacity-90">
                    Discover our premium collection tailored just for you.
                  </p>
                  <ThemedButton
                    asChild
                    size="lg"
                    colorRole="primary"
                    className={cn(
                      'px-8 py-4 text-lg font-medium transition-transform hover:scale-105',
                      radiusClass
                    )}
                  >
                    <Link href={asRoute(getFullHref('/category/all'))}>
                      Shop Now
                    </Link>
                  </ThemedButton>
                </div>
              </div>
            </div>
          ) : (
            // Split Layout
            <div className="container mx-auto px-4 py-12 lg:py-24">
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div className="space-y-8">
                  <h1
                    className="text-5xl md:text-7xl font-bold tracking-tight"
                    style={{ color: theme.colors.primary }}
                  >
                    {merchant?.business_name || 'Welcome'}
                  </h1>
                  <p className="text-xl opacity-80 max-w-lg">
                    Experience quality and craftsmanship in every product we
                    offer.
                  </p>
                  <ThemedButton
                    asChild
                    size="lg"
                    colorRole="primary"
                    className={cn(
                      'px-8 py-4 text-lg font-medium flex items-center gap-2 transition-all hover:gap-4',
                      radiusClass
                    )}
                  >
                    <Link href={asRoute(getFullHref('/category/all'))}>
                      Explore Collection <ArrowRight className="size-5" />
                    </Link>
                  </ThemedButton>
                </div>
                <div
                  className={cn(
                    'relative h-[500px] overflow-hidden shadow-2xl',
                    radiusClass
                  )}
                >
                  <Image
                    src={heroImage}
                    alt="Hero"
                    fill
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    className="object-cover transition-transform hover:scale-105 duration-700"
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* --- Dynamic Browse Rail --- */}
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
              categories.map((cat, _i) => (
                <Link
                  key={cat.href}
                  href={asRoute(getFullHref(cat.href))}
                  className={cn(
                    'group flex flex-col items-center justify-center p-6 transition-all hover:shadow-lg border',
                    radiusClass,
                    theme.layout.categoryRail === 'circle' &&
                      'aspect-square rounded-full',
                    theme.layout.categoryRail === 'pill' && 'aspect-2/1',
                    theme.layout.categoryRail === 'square' && 'aspect-square',
                    theme.layout.categoryRail === 'card' && 'aspect-4/3'
                  )}
                  style={{
                    backgroundColor: theme.colors.card,
                    borderColor:
                      theme.colors.background === '#09090B'
                        ? '#27272A'
                        : '#E5E7EB',
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
                allBrands.map((brand, _i) => (
                  <Link
                    key={brand}
                    href={asRoute(getFullHref(`/search?q=${brand}`))}
                    className={cn(
                      'group flex flex-col items-center justify-center p-6 transition-all hover:shadow-lg border',
                      radiusClass,
                      'aspect-4/3'
                    )}
                    style={{
                      backgroundColor: theme.colors.card,
                      borderColor:
                        theme.colors.background === '#09090B'
                          ? '#27272A'
                          : '#E5E7EB',
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
              PRICE_RANGES.map((range, _i) => (
                <Link
                  key={range.href}
                  href={asRoute(getFullHref(range.href))}
                  className={cn(
                    'group flex flex-col items-center justify-center p-6 transition-all hover:shadow-lg border',
                    radiusClass,
                    'aspect-4/3'
                  )}
                  style={{
                    backgroundColor: theme.colors.card,
                    borderColor:
                      theme.colors.background === '#09090B'
                        ? '#27272A'
                        : '#E5E7EB',
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

        {/* --- Dynamic Product Grid --- */}
        <section className="py-12 container mx-auto px-4">
          <StorefrontProductGrid
            title="Featured Products"
            columns={4}
            limit={4}
            // We can pass styles to the grid if it supports them,
            // otherwise we rely on global theme vars or wrapper styles.
            // For now, the grid is standard, but we wrap it to control context if needed.
          />
        </section>

        {/* --- Newsletter --- */}
        <Newsletter
          title="Stay Updated"
          subtitle="Join our mailing list for exclusive offers."
          buttonText="Subscribe"
          backgroundColor={theme.colors.card}
        />
      </main>

      <Footer
        backgroundColor={theme.colors.primary}
        textColor="#ffffff"
        showNewsletter={false}
      />
    </div>
  );
}
