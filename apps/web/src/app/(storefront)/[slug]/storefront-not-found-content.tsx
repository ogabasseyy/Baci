'use client';

import { ArrowLeft, Home, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { useMerchantSafe } from '@/hooks/merchant/use-merchant';
import { asRoute } from '@/lib/routes';

function normalizeBasePath(basePath: string | null | undefined): string {
  const normalizedSegment = basePath?.trim().replace(/^\/+|\/+$/g, '') ?? '';
  return normalizedSegment ? `/${normalizedSegment}` : '';
}

function buildStorefrontPath(
  basePath: string | null | undefined,
  suffix: '/' | '/#products' | '/pages/contact'
): string {
  const normalizedBasePath = normalizeBasePath(basePath);
  if (suffix === '/') {
    return normalizedBasePath ? `${normalizedBasePath}/` : '/';
  }

  return `${normalizedBasePath}${suffix}`;
}

const STOREFRONT_NOT_FOUND_CRITICAL_CSS = `
[data-storefront-not-found] {
  position: relative; isolation: isolate; display: flex; min-height: calc(100svh - 4rem);
  flex-direction: column; align-items: center; justify-content: center;
  background: var(--store-background, #ffffff); color: var(--store-background-text, #111827);
  padding: 4rem 1rem;
}
[data-storefront-not-found-card] {
  max-width: 32rem; border-radius: 1.5rem; border: 1px solid var(--store-border, #e5e7eb);
  background: var(--store-background, #ffffff); padding: 1.5rem; text-align: center;
}
[data-storefront-not-found-code] {
  font-size: 6rem; line-height: 1; font-weight: 700; color: var(--store-primary, #d62027); opacity: 0.2;
}
[data-storefront-not-found-card] h1 {
  margin-top: -2rem; font-size: 1.875rem; line-height: 2.25rem; font-weight: 700; color: var(--store-primary, #d62027);
}
[data-storefront-not-found-actions] {
  display: flex; flex-direction: column; gap: 1rem; justify-content: center; padding-top: 1rem;
}
[data-storefront-not-found-actions] a {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  border-radius: 0.5rem; padding: 0.625rem 1.5rem; font-weight: 500; text-decoration: none;
}
[data-storefront-not-found] svg { width: 1rem; height: 1rem; flex-shrink: 0; }
@media (min-width: 640px) {
  [data-storefront-not-found] { padding: 4rem 2rem; }
  [data-storefront-not-found-card] { padding: 2rem; }
  [data-storefront-not-found-actions] { flex-direction: row; }
}
`.trim();

export function StorefrontNotFoundContent() {
  useEffect(() => {
    void import('@/app/(storefront)/storefront-not-found.css').catch(
      () => undefined
    );
  }, []);

  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;
  const isLoading = merchantContext?.loading;
  const basePath = merchantContext?.basePath;
  const storeName = merchant?.business_name || 'Store';
  const storefrontHomeHref = asRoute(buildStorefrontPath(basePath, '/'));
  const storefrontProductsHref = asRoute(
    buildStorefrontPath(basePath, '/#products')
  );
  const storefrontContactHref = asRoute(
    buildStorefrontPath(basePath, '/pages/contact')
  );

  if (isLoading) {
    return (
      <div
        className="relative isolate flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center bg-store-background p-8 text-store-background-text animate-pulse"
        data-storefront-not-found="true"
        role="status"
        aria-label="Loading page"
      >
        <style>{STOREFRONT_NOT_FOUND_CRITICAL_CSS}</style>
        <div className="h-32 w-48 bg-store-background-text/10 rounded-lg mb-8" />
        <div className="h-8 w-64 bg-store-background-text/10 rounded mb-4" />
        <div className="h-4 w-96 bg-store-background-text/10 rounded" />
      </div>
    );
  }

  return (
    <div
      className="relative isolate flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center bg-store-background px-4 py-16 text-store-background-text sm:px-8"
      data-storefront-not-found="true"
    >
      <style>{STOREFRONT_NOT_FOUND_CRITICAL_CSS}</style>
      <div
        className="text-center space-y-6 max-w-lg rounded-3xl border border-store-border bg-store-background/95 p-6 shadow-2xl sm:p-8"
        data-storefront-not-found-card="true"
      >
        <div
          className="text-8xl font-bold text-store-primary opacity-20 md:text-9xl"
          data-storefront-not-found-code="true"
        >
          404
        </div>

        <h1 className="-mt-8 text-3xl font-bold text-store-primary md:text-4xl">
          Page Not Found
        </h1>

        <p className="text-store-background-text text-lg">
          We couldn&apos;t find what you&apos;re looking for. The page may have
          been moved, deleted, or never existed.
        </p>

        <div
          className="flex flex-col sm:flex-row gap-4 justify-center pt-4"
          data-storefront-not-found-actions="true"
        >
          <Link
            href={storefrontHomeHref}
            className="inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-store-primary px-8 text-sm font-medium text-store-primary-text transition-colors hover:bg-store-primary/90 sm:w-auto"
          >
            <Home className="mr-2 size-4" />
            Back to {storeName}
          </Link>
          <Link
            href={storefrontProductsHref}
            className="inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md border border-store-accent bg-transparent px-8 text-sm font-medium text-store-accent transition-colors hover:bg-store-accent/10 sm:w-auto"
          >
            <Search className="mr-2 size-4" />
            Browse Products
          </Link>
        </div>

        <div className="pt-8 border-t border-store-border mt-8">
          <p className="text-sm text-store-background-text mb-4">
            Here are some helpful links:
          </p>
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <Link
              href={storefrontHomeHref}
              className="text-store-background-text hover:text-store-primary transition-colors flex items-center gap-1"
            >
              <ArrowLeft className="size-3" /> Home
            </Link>
            <span aria-hidden="true" className="text-store-border">
              |
            </span>
            <Link
              href={storefrontProductsHref}
              className="text-store-background-text hover:text-store-primary transition-colors"
            >
              All Products
            </Link>
            {merchant?.pages?.contact && (
              <>
                <span aria-hidden="true" className="text-store-border">
                  |
                </span>
                <Link
                  href={storefrontContactHref}
                  className="text-store-background-text hover:text-store-primary transition-colors"
                >
                  Contact Us
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
