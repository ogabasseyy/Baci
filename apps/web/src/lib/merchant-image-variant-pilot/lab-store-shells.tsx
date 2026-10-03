'use client';

import { HeaderLogo } from '@/components/storefront/blocks/header-logo';
import { StorefrontProductCard } from '@/components/storefront/product-card';
import type { Product } from '@/lib/products';
import { LabStorefrontProductCard, labProductFixture } from './lab-card-clone';
import { LabHeaderLogo, LabStoreHeader } from './lab-header-clone';
import type { PilotLabArm } from './lab-mount';
import type { ProjectedPilotImage } from './next-image-adapter';

// Lab-only client shells for the per-store pages. Server components cannot
// pass function props (getHref, cart handlers) to client components, so the
// shells own every callback and stay serializable at the server boundary:
// data (products, projections) in, no closures out. Both arms render the
// same shell; only the mounted image component differs.

// Lab-scoped hrefs: store pages never link production. PDP/cart hrefs stay
// inside the lab route so crawlers and matched runs cannot escape it.
function labHref(basePath: string, path: string): string {
  return `${basePath}${path}`;
}

function noopProduct(_product: Product): void {
  // Lab grid is a measurement surface: commerce actions are inert by design.
}
function noopQuantity(_productId: string, _quantity: number): void {
  // Lab grid is a measurement surface: commerce actions are inert by design.
}

export function LabStoreHeaderBar({
  arm,
  basePath,
  layout,
  projection,
  stagedOriginal,
  storeName,
}: {
  arm: PilotLabArm;
  basePath: string;
  layout: 'logo-left-nav-center' | 'logo-left-nav-right' | 'logo-center';
  // Pilot arm only; the control arm renders the original with the staged URL.
  projection: ProjectedPilotImage | null;
  stagedOriginal: string;
  storeName: string;
}) {
  const getHref = (path: string) => labHref(basePath, path);
  return (
    <LabStoreHeader storeName={storeName}>
      {arm === 'pilot' && projection ? (
        <LabHeaderLogo
          getHref={getHref}
          layout={layout}
          projection={projection}
          storeName={storeName}
        />
      ) : (
        <HeaderLogo
          storeName={storeName}
          getHref={getHref}
          layout={layout}
          logoUrl={stagedOriginal}
        />
      )}
    </LabStoreHeader>
  );
}

// Production grid shell (product-grid-items.tsx, columns=4 default):
// grid-cols-1 -> sm:2 -> md:3 -> lg:4, gap-6, stagger-1..4, priority<4.
const LAB_GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6';

const LAB_STAGGER_CLASSES = [
  'stagger-1',
  'stagger-2',
  'stagger-3',
  'stagger-4',
];

export interface LabGridFiller {
  imageHint: string;
  name: string;
  price: number;
}

export function LabStoreGrid({
  arm,
  basePath,
  fillerImageUrl,
  fillers,
  mountedProduct,
  mountedProjection,
}: {
  arm: PilotLabArm;
  basePath: string;
  // Frozen filler asset, identical in both arms. Fillers must NEVER reuse
  // the mounted product's image: re-fetching the selected original in the
  // candidate would swamp the byte-saving comparison with unrelated bytes.
  fillerImageUrl: string;
  fillers: readonly LabGridFiller[];
  mountedProduct: Product;
  // Pilot arm only; the control arm renders the original with the staged URL.
  mountedProjection: ProjectedPilotImage | null;
}) {
  return (
    <div className={LAB_GRID_CLASSES}>
      {/* Selected-card identity wrapper (both arms): the served gate checks
          THIS subtree's image for the binding — fillers later in the grid
          must never satisfy it. */}
      <div data-pilot-lab-selected-card="true">
        {arm === 'pilot' && mountedProjection ? (
          <LabStorefrontProductCard
            product={mountedProduct}
            projection={mountedProjection}
            staggerClass={LAB_STAGGER_CLASSES[0] ?? 'stagger-1'}
            onAddToCart={noopProduct}
            onUpdateQuantity={noopQuantity}
            onQuickView={noopProduct}
            basePath={basePath}
          />
        ) : (
          <StorefrontProductCard
            product={mountedProduct}
            staggerClass={LAB_STAGGER_CLASSES[0] ?? 'stagger-1'}
            onAddToCart={noopProduct}
            onUpdateQuantity={noopQuantity}
            onQuickView={noopProduct}
            basePath={basePath}
            priority
          />
        )}
      </div>
      {fillers.map((filler, index) => (
        <StorefrontProductCard
          key={`lab-filler-${filler.name}`}
          product={labProductFixture({
            compareAtPrice: filler.price + 500,
            id: `lab-filler-${index + 2}`,
            imageHint: filler.imageHint,
            imageLarge: fillerImageUrl,
            name: filler.name,
            price: filler.price,
          })}
          staggerClass={LAB_STAGGER_CLASSES[index + 1] ?? 'stagger-2'}
          onAddToCart={noopProduct}
          onUpdateQuantity={noopQuantity}
          onQuickView={noopProduct}
          basePath={basePath}
          priority
        />
      ))}
    </div>
  );
}
