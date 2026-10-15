import { getProductUrl } from '@/lib/product-url';
import { LAB_GRID_FILLERS, labProductFixture } from './lab-fixtures';
import type { PilotLabStore } from './lab-store-registry';

// Hero-slide destination slugs: literal hrefs in labHeroSlides (not the
// card renderer), identical for every store.
const LAB_HERO_SLIDE_SLUGS = ['lab-hero-slide-0', 'lab-hero-slide-1'];

// Finite fixture-product slugs the lab-category route serves for a store:
// the mounted card, the three grid fillers, and the hero slides. Card
// slugs run through the REAL product-href chain (same builder the cards
// render), so the set cannot drift from what browsers prefetch — the
// route 404s anything outside it instead of reflecting unknown slugs.
export function pilotLabFixtureProductSlugs(
  store: PilotLabStore
): ReadonlySet<string> {
  const slugs = new Set<string>(LAB_HERO_SLIDE_SLUGS);
  const products = [
    // Same name the grid section mounts; image fields never enter the
    // href chain (slug/name/id/categories only).
    labProductFixture({
      imageHint: 'lab mounted product',
      imageLarge: '',
      name: `${store.storeName} Lab Product`,
    }),
    // Same construction as the grid shell (ids feed the slug fallback).
    ...LAB_GRID_FILLERS.map((filler, index) =>
      labProductFixture({
        compareAtPrice: filler.price + 500,
        id: `lab-filler-${index + 2}`,
        imageHint: filler.imageHint,
        imageLarge: '',
        name: filler.name,
        price: filler.price,
      })
    ),
  ];
  for (const product of products) {
    const segment = new URL(
      getProductUrl(product),
      'https://pilot-lab.invalid'
    ).pathname
      .split('/')
      .pop();
    if (segment) {
      slugs.add(segment);
    }
  }
  return slugs;
}
