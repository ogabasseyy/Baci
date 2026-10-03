// Frozen pilot sample (handoff 2026-10-01): the four selected stores and the
// six selected bindings. merchantIds are the inventory's; slugs/names are
// the handoff's canonical sample-store names.
export type PilotLabSlotId =
  | 'header-logo'
  | 'product-card'
  | 'mobile-hero-slide-0';

export interface PilotLabStore {
  merchantId: string;
  slug: string;
  storeName: string;
  slots: readonly PilotLabSlotId[];
}

export const PILOT_LAB_STORES: readonly PilotLabStore[] = [
  {
    merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20',
    slug: 'omnimart',
    storeName: 'Omnimart',
    slots: ['header-logo', 'product-card'],
  },
  {
    merchantId: 'ce33cde7-fb48-4a6e-9742-e8ed4e2d137f',
    slug: 'squishyland',
    storeName: 'SquishyLand',
    slots: ['product-card'],
  },
  {
    merchantId: 'da7e7edf-a84f-4cdb-8a51-52d8722e7f6f',
    slug: 'zorvexa',
    storeName: 'Zorvexa',
    slots: ['header-logo', 'product-card'],
  },
  {
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    slug: 'ogabassey',
    storeName: 'OgaBassey',
    slots: ['mobile-hero-slide-0'],
  },
];

export function pilotLabStoreBySlug(slug: string): PilotLabStore | null {
  return PILOT_LAB_STORES.find((store) => store.slug === slug) ?? null;
}

export function pilotLabStoreBasePath(store: PilotLabStore): string {
  return `/pilot-lab/store/${store.slug}`;
}
