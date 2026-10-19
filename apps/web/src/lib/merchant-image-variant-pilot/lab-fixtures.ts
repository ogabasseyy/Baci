import { getProductImageAlt } from '@baci/shared/lib';
import type { Product } from '@/lib/products';
import type { PilotImageSlot } from './next-image-adapter';

// Server-safe lab fixtures shared by the store pages (server) and the lab
// clones (client). These MUST stay in a directive-free module: the store
// page calls them during SSR, and calling an exported function from a
// 'use client' module throws at request time
// (lab-server-boundary.test.ts guards this). The clone modules re-export
// them so parity tests keep importing from the clone surface.

// Frozen grid-filler images (committed, hash-pinned in
// lab-store-grid-section.test.tsx), one per sibling card. Grid fillers
// render these synthetic assets — never a copy of the selected binding's
// original — identically in both arms, so the byte comparison isolates
// the selected slot instead of re-downloading its original in the
// candidate. Each card gets a DISTINCT filler URL: siblings sharing one
// URL coalesce into a single browser request, which would understate the
// connection contention a real storefront's distinct product images
// impose on the selected priority card. Served absolute like every
// card-path URL (the original card renderer rejects relative URLs).
export const PILOT_LAB_FILLER_IMAGES: readonly string[] = [
  '/__pilot/fillers/grid-filler-600x400-a.png',
  '/__pilot/fillers/grid-filler-600x400-b.png',
  '/__pilot/fillers/grid-filler-600x400-c.png',
];

// Absolute filler URL for the card path (the original card renderer rejects
// relative URLs) — one builder so both arms resolve the same frozen asset
// per sibling position. Out-of-range indexes throw: silently reusing one
// filler would reintroduce request coalescing.
export function pilotLabFillerImageUrl(origin: string, index: number): string {
  const path = PILOT_LAB_FILLER_IMAGES[index];
  if (!path) {
    throw new Error(
      `merchant image pilot: filler index ${index} has no frozen asset`
    );
  }
  return new URL(path, origin).href;
}

export interface LabGridFiller {
  imageHint: string;
  name: string;
  price: number;
}

// Grid sibling fillers: fixed commerce fields so the three sibling cards
// are distinct products in both arms. Lives here (not the grid section)
// so the fixture-product route derives the same finite slug set from the
// same data — one source of truth for what the lab links to.
export const LAB_GRID_FILLERS: readonly LabGridFiller[] = [
  { imageHint: 'lab filler product two', name: 'Lab Filler Two', price: 1800 },
  {
    imageHint: 'lab filler product three',
    name: 'Lab Filler Three',
    price: 3200,
  },
  {
    imageHint: 'lab filler product four',
    name: 'Lab Filler Four',
    price: 4100,
  },
];

export const LAB_CARD_GEOMETRY = {
  height: 400,
  sizes:
    '(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw',
  width: 600,
} as const;

export function labCardSlot(
  product: Product,
  options?: { priority?: boolean }
): PilotImageSlot {
  // ProductGridItems passes priority={index < 4}; the mounted card is grid
  // index 0, so it is ALWAYS a priority card in the store pages (high/eager
  // + a preload owner). The priority=false shape is locked by parity test
  // only (proving the clone is slot-driven, not hardcoded).
  const priority = options?.priority ?? true;
  return {
    alt: getProductImageAlt(product, { includeBrandFallback: false }),
    // ProductCardImage maps priority to fetchPriority high/low +
    // loading eager/lazy (see optimized-image.tsx).
    fetchPriority: priority ? 'high' : 'low',
    height: LAB_CARD_GEOMETRY.height,
    loading: priority ? 'eager' : 'lazy',
    sizes: LAB_CARD_GEOMETRY.sizes,
    width: LAB_CARD_GEOMETRY.width,
  };
}

// Lab product fixture: the selected binding's image mounted on a minimal
// in-stock product. Commerce fields are fixed lab constants (identical arms);
// only the image URL varies by arm. Fillers override id/name/price so grid
// siblings are distinct products sharing the staged URL.
export function labProductFixture(input: {
  compareAtPrice?: number;
  id?: string;
  imageHint: string;
  imageLarge: string;
  name: string;
  price?: number;
}): Product {
  const id = input.id ?? 'lab-product-1';
  return {
    id,
    name: input.name,
    description: 'Lab fixture product for the merchant image variant pilot.',
    status: 'active',
    price: input.price ?? 2500,
    compare_at_price: input.compareAtPrice ?? 3000,
    manage_stock: true,
    stock: 12,
    image: input.imageLarge,
    imageLarge: input.imageLarge,
    imageHint: input.imageHint,
    brand: 'Lab Brand',
    gtin: `${id}-gtin`,
    mpn: `${id}-mpn`,
    category: 'Lab Category',
  };
}
