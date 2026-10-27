import { render } from '@testing-library/react';
import type * as NextImageModule from 'next/image';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { OgabasseyPdpCriticalShell } from './critical-shell';
import type { OgabasseyPdpCriticalProduct } from './critical-product';

export type { OgabasseyPdpCriticalProduct };

vi.mock('next/image', async (importOriginal) => ({
  // Keep the REAL getImageProps for the migrated <picture>/AVIF path while the
  // default export stays this suite's attribute-exposing test double.
  ...(await importOriginal<typeof NextImageModule>()),
  default: ({
    alt,
    fetchPriority,
    fill,
    loader,
    loading,
    preload,
    quality,
    sizes,
    src,
  }: {
    alt: string;
    fetchPriority?: string;
    fill?: boolean;
    loader?: (params: {
      quality?: number;
      src: string;
      width: number;
    }) => string;
    loading?: string;
    preload?: boolean;
    quality?: number;
    sizes?: string;
    src: string;
  }) => {
    const resolvedSrc = loader
      ? loader({ quality, src, width: 3840 })
      : src;
    const srcSet = loader
      ? [640, 750]
          .map((width) => `${loader({ quality, src, width })} ${width}w`)
          .join(', ')
      : `${src} 640w`;

    return (
      // biome-ignore lint/performance/noImgElement: next/image test double exposes rendered attributes
      <img
        alt={alt}
        data-fetch-priority={fetchPriority}
        data-fill={String(Boolean(fill))}
        data-loading={loading}
        data-preload={String(Boolean(preload))}
        sizes={sizes}
        src={resolvedSrc}
        srcSet={srcSet}
      />
    );
  },
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a data-prefetch={String(prefetch)} href={href}>
      {children}
    </a>
  ),
}));


export const isBefore = (
  first: Element | null | undefined,
  second: Element | null | undefined
): boolean =>
  Boolean(
    first &&
      second &&
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
  );

export const defaultProduct: OgabasseyPdpCriticalProduct = {
  brand: 'Samsung',
  categoryName: 'Smartphones',
  categorySlug: 'smartphones',
  condition: 'new',
  id: 'product-1',
  image: 'https://cdn.ogabassey.com/core-assets/products/galaxy-trifold.avif',
  imageVersion: 'lcpv1',
  name: 'Samsung Galaxy Z TriFold',
  price: 5_800_000,
  rating: 0,
  ratingCount: 0,
  reviewCount: 0,
  slug: 'samsung-galaxy-z-trifold',
  stockQuantity: 3,
};

export function renderCriticalShell(
  productOverrides: Partial<OgabasseyPdpCriticalProduct> = {},
  children?: ReactNode
) {
  return render(
    <OgabasseyPdpCriticalShell
      basePath=""
      product={{ ...defaultProduct, ...productOverrides }}
    >
      {children}
    </OgabasseyPdpCriticalShell>
  );
}
