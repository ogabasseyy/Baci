// Frozen pilot sample (handoff 2026-10-01): the four selected stores and the
// six selected bindings. merchantIds are the inventory's; slugs/names are
// the handoff's canonical sample-store names.
export type PilotLabSlotId =
  | 'header-logo'
  | 'product-card'
  | 'mobile-hero-slide-0'
  | 'hero-banner';

// Committed-plan consumer without frozen sample coverage. The store page
// renders an explicit uncovered marker for each entry, so the served and
// readiness reports name the gap instead of silently excluding the
// consumer from every denominator. Freezing snapshots for the slot
// promotes it from uncoveredSlots into the store's sampled slots.
export interface PilotLabUncoveredSlot {
  // Baseline renderer, e.g. the builder CSS-background hero component.
  consumer: string;
  reason: string;
  slotId: PilotLabSlotId;
}

export interface PilotLabStore {
  merchantId: string;
  slug: string;
  storeName: string;
  slots: readonly PilotLabSlotId[];
  uncoveredSlots: readonly PilotLabUncoveredSlot[];
}

export const PILOT_LAB_STORES: readonly PilotLabStore[] = [
  {
    merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20',
    slug: 'omnimart',
    storeName: 'Omnimart',
    slots: ['header-logo', 'product-card'],
    // Plan §3 row 2: the builder hero bypasses the shared loader via CSS
    // backgroundImage, so no sampled binding exercises it.
    uncoveredSlots: [
      {
        consumer:
          'heroComponent.render (builder/hero-component.tsx, CSS backgroundImage)',
        reason: 'no frozen hero-banner snapshot in the pilot sample',
        slotId: 'hero-banner',
      },
    ],
  },
  {
    merchantId: 'ce33cde7-fb48-4a6e-9742-e8ed4e2d137f',
    slug: 'squishyland',
    storeName: 'SquishyLand',
    slots: ['product-card'],
    // Plan §3 row 5: same shared builder hero file as Omnimart.
    uncoveredSlots: [
      {
        consumer:
          'heroComponent.render (builder/hero-component.tsx, CSS backgroundImage)',
        reason: 'no frozen hero-banner snapshot in the pilot sample',
        slotId: 'hero-banner',
      },
    ],
  },
  {
    merchantId: 'da7e7edf-a84f-4cdb-8a51-52d8722e7f6f',
    slug: 'zorvexa',
    storeName: 'Zorvexa',
    slots: ['header-logo', 'product-card'],
    uncoveredSlots: [],
  },
  {
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    slug: 'ogabassey',
    storeName: 'OgaBassey',
    slots: ['mobile-hero-slide-0'],
    uncoveredSlots: [],
  },
];

export function pilotLabStoreBySlug(slug: string): PilotLabStore | null {
  return PILOT_LAB_STORES.find((store) => store.slug === slug) ?? null;
}

export function pilotLabStoreBasePath(store: PilotLabStore): string {
  return `/pilot-lab/store/${store.slug}`;
}
