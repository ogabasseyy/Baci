import 'server-only';
import { getImageProps } from 'next/image';
import { HeroMobileCarousel } from '@/components/storefront/ogabassey/components/hero-mobile-carousel';
import {
  MOBILE_HERO_IMAGE_HEIGHT,
  MOBILE_HERO_IMAGE_QUALITY,
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_IMAGE_WIDTH,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { ogabasseyFallbackImageLoader } from '@/lib/ogabassey-image-fallback-loader';
import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';
import type { PilotLabConfig } from './lab-config';
import {
  labCardSlot,
  labHeroSlides,
  labHeroSlot,
  labProductFixture,
  pilotLabFillerImageUrl,
} from './lab-fixtures';
import { LabHeroMobileCarousel } from './lab-hero-clone';
import type { PilotBindingStatus } from './lab-index';
import {
  type PilotLabArm,
  PilotLabCardPreload,
  PilotLabFlightPreload,
  PilotLabNotOptimized,
  PilotLabScannerLink,
} from './lab-mount';
import {
  type LabGridFiller,
  LabStoreGrid,
  LabStoreHeaderBar,
} from './lab-store-shells';
import { projectPilotNextImage } from './next-image-adapter';
import {
  projectControlOgabasseyMobile,
  projectPilotOgabasseyMobile,
} from './ogabassey-mobile-adapter';
import { resolvePilotSlot } from './resolver';

// Per-store lab pages: the measurement surfaces for the merchant image
// pilot. Each store page renders the ACTUAL selected storefront components
// and shells — not the gallery's generic mounts:
// - control arm: ORIGINAL renderers (HeaderLogo, StorefrontProductCard,
//   HeroMobileCarousel) with staged original URLs;
// - pilot arm: lab clones with ONLY the image element changed (explicit
//   staged srcSets), proved by the per-clone parity tests.
//
// Both arms share shells, commerce fixtures, hrefs, and discovery timing:
// priority slots carry matched preload owners in both arms (the control
// hero's hint is derived from the original's own loader chain — see
// deriveControlHeroHint). The gallery (/pilot-lab) remains as a projection
// fixture aid; CWV claims may only come from these store pages.

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

// Frozen pilot sample (handoff 2026-10-01): the four selected stores and the
// six selected bindings. merchantIds are the inventory's; slugs/names are
// the handoff's canonical sample-store names.
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

function statusFor(
  config: PilotLabConfig,
  merchantId: string,
  slotId: string
): PilotBindingStatus | null {
  return (
    config.statuses.find(
      (status) =>
        status.binding.merchantId === merchantId &&
        status.binding.slotId === slotId
    ) ?? null
  );
}

function resolveBinding(
  config: PilotLabConfig,
  binding: PilotInventoryBinding
) {
  const resolved = resolvePilotSlot(config.index, config.bindings, {
    baseUrl: config.baseUrl,
    merchantId: binding.merchantId,
    originalUrl: binding.originalUrl,
    slotId: binding.slotId,
  });
  const stagedOriginal = config.originalUrlFor({
    merchantId: binding.merchantId,
    slotId: binding.slotId,
  });
  return { resolved, stagedOriginal };
}

// Control-hero hint derivation. The original MobileLcpHeroImage renders its
// slide-0 srcSet through getImageProps with the args below; the lab control
// arm must preload EXACTLY that srcSet or discovery timing differs from the
// pilot arm (and from production, which ships a matched committed hint).
// This mirrors MobileLcpHeroImage's getImageProps call argument-for-argument;
// lab-store-page.test.ts fails loudly if the rendered srcSet ever drifts.
export function deriveControlHeroHint(input: {
  alt: string;
  stagedOriginalUrl: string;
}): { href: string; imageSizes: string; imageSrcSet: string } {
  const {
    props: { sizes, src, srcSet },
  } = getImageProps({
    alt: input.alt,
    decoding: 'sync',
    fetchPriority: 'high',
    height: MOBILE_HERO_IMAGE_HEIGHT,
    loader: ogabasseyFallbackImageLoader,
    loading: 'eager',
    quality: MOBILE_HERO_IMAGE_QUALITY,
    sizes: MOBILE_HERO_IMAGE_SIZES,
    src: input.stagedOriginalUrl,
    width: MOBILE_HERO_IMAGE_WIDTH,
  });
  return {
    href: src,
    imageSizes: sizes ?? MOBILE_HERO_IMAGE_SIZES,
    imageSrcSet: srcSet ?? src,
  };
}

function MissingBinding({
  slotId,
  store,
}: {
  slotId: string;
  store: PilotLabStore;
}): React.JSX.Element {
  return (
    <section
      data-pilot-lab-slot={slotId}
      data-pilot-lab-status="missing-binding"
    >
      <h2>{slotId} — missing binding</h2>
      <p>
        {`store "${store.slug}" expects slot "${slotId}" but the inventory has no binding for merchant "${store.merchantId}"; refusing to render rather than mixing arms.`}
      </p>
    </section>
  );
}

function LabStoreHeaderSection({
  arm,
  basePath,
  config,
  status,
  store,
}: {
  arm: PilotLabArm;
  basePath: string;
  config: PilotLabConfig;
  status: PilotBindingStatus;
  store: PilotLabStore;
}) {
  const { binding } = status;
  if (status.status !== 'accepted') {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason={`binding status "${status.status}"${status.detail ? `: ${status.detail}` : ''}; the control path is retained and this slot is excluded from the optimized denominator.`}
      />
    );
  }
  const { resolved, stagedOriginal } = resolveBinding(config, binding);
  if (!resolved || !stagedOriginal) {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason="accepted binding has no staged tiers or original; refusing to render rather than mixing arms."
      />
    );
  }
  // Fixed 40px lockup box (header-logo.tsx). sizes="40px" is the faithful
  // w-descriptor translation of the original's fixed-size 1x/2x selection:
  // the 40w tier serves 1x, the 80w tier serves 2x — same bytes.
  const slot = {
    alt: store.storeName,
    height: 40,
    sizes: '40px',
    width: 40,
  };
  const projection =
    arm === 'pilot'
      ? projectPilotNextImage({
          baseUrl: config.baseUrl,
          slot,
          tiers: resolved.tiers,
        })
      : null;
  if (arm === 'pilot' && !projection) {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason="logo projection is empty for the pilot arm."
      />
    );
  }
  return (
    <section
      data-pilot-lab-binding={`${binding.merchantId}/${binding.assetId}`}
      data-pilot-lab-slot={binding.slotId}
    >
      <LabStoreHeaderBar
        arm={arm}
        basePath={basePath}
        layout="logo-left-nav-center"
        projection={projection}
        stagedOriginal={stagedOriginal}
        storeName={store.storeName}
      />
    </section>
  );
}

const LAB_GRID_FILLERS: readonly LabGridFiller[] = [
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

function LabStoreGridSection({
  arm,
  basePath,
  config,
  origin,
  status,
  store,
}: {
  arm: PilotLabArm;
  basePath: string;
  config: PilotLabConfig;
  origin: string;
  status: PilotBindingStatus;
  store: PilotLabStore;
}) {
  const { binding } = status;
  if (status.status !== 'accepted') {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason={`binding status "${status.status}"${status.detail ? `: ${status.detail}` : ''}; the control path is retained and this slot is excluded from the optimized denominator.`}
      />
    );
  }
  const { resolved, stagedOriginal } = resolveBinding(config, binding);
  if (!resolved || !stagedOriginal) {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason="accepted binding has no staged tiers or original; refusing to render rather than mixing arms."
      />
    );
  }
  // Absolute staged URLs on the card path, both arms: the ORIGINAL card
  // renderer (OptimizedImage) rejects relative URLs via isValidImageUrl and
  // renders /placeholder.svg instead, so relative staged URLs cannot mount
  // the real storefront grid. This mirrors production, where product images
  // are absolute CDN URLs; the pilot clone projects the same absolute form
  // so only the image bytes (not the URL shape) vary between arms.
  const cardBaseUrl = `${origin}${config.baseUrl}`;
  const cardOriginal = new URL(stagedOriginal, origin).href;
  const fillerImageUrl = pilotLabFillerImageUrl(origin);
  const mountedProduct = labProductFixture({
    imageHint: `${binding.assetId} lab product`,
    imageLarge: cardOriginal,
    name: `${store.storeName} Lab Product`,
  });
  const slot = labCardSlot(mountedProduct);
  const projection =
    arm === 'pilot'
      ? projectPilotNextImage({
          baseUrl: cardBaseUrl,
          slot,
          tiers: resolved.tiers,
        })
      : null;
  if (arm === 'pilot' && !projection) {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason="card projection is empty for the pilot arm."
      />
    );
  }
  return (
    <section
      data-pilot-lab-binding={`${binding.merchantId}/${binding.assetId}`}
      data-pilot-lab-slot={binding.slotId}
    >
      {arm === 'pilot' && projection ? (
        <PilotLabCardPreload projection={projection} />
      ) : null}
      <LabStoreGrid
        arm={arm}
        basePath={basePath}
        fillerImageUrl={fillerImageUrl}
        fillers={LAB_GRID_FILLERS}
        mountedProduct={mountedProduct}
        mountedProjection={projection}
      />
    </section>
  );
}

function LabStoreHeroSection({
  arm,
  basePath,
  config,
  status,
  store,
}: {
  arm: PilotLabArm;
  basePath: string;
  config: PilotLabConfig;
  status: PilotBindingStatus;
  store: PilotLabStore;
}) {
  const { binding } = status;
  if (status.status !== 'accepted') {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason={`binding status "${status.status}"${status.detail ? `: ${status.detail}` : ''}; the control path is retained and this slot is excluded from the optimized denominator.`}
      />
    );
  }
  const { resolved, stagedOriginal } = resolveBinding(config, binding);
  if (!resolved || !stagedOriginal) {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason="accepted binding has no staged tiers or original; refusing to render rather than mixing arms."
      />
    );
  }
  const heroAlt = `${binding.assetId} lab hero`;
  const slides = labHeroSlides({
    basePath,
    slide0: {
      imageAlt: heroAlt,
      imageUrl: stagedOriginal,
      name: `${store.storeName} Lab Launch`,
    },
    slide1: {
      imageAlt: `${heroAlt} filler`,
      imageUrl: stagedOriginal,
      name: `${store.storeName} Lab Launch Filler`,
    },
  });
  const slot = labHeroSlot(heroAlt);
  if (arm === 'control') {
    // Matched discovery: the control hint preloads exactly what the
    // original renderer paints (derived from its own loader chain), so the
    // arms differ in bytes — not in discovery timing. Format-agnostic
    // (no AVIF gate): the original bytes decode everywhere.
    const control = projectControlOgabasseyMobile({
      originalUrl: stagedOriginal,
      slot,
    });
    const hint = deriveControlHeroHint({
      alt: heroAlt,
      stagedOriginalUrl: stagedOriginal,
    });
    const hintProjection = {
      ...control,
      preload: {
        ...control.preload,
        href: hint.href,
        imageSizes: hint.imageSizes,
        imageSrcSet: hint.imageSrcSet,
      },
    };
    return (
      <section
        data-pilot-lab-binding={`${binding.merchantId}/${binding.assetId}`}
        data-pilot-lab-slot={binding.slotId}
      >
        <PilotLabFlightPreload projection={hintProjection} type={null} />
        <PilotLabScannerLink
          arm={arm}
          binding={`${binding.merchantId}/${binding.assetId}`}
          projection={hintProjection}
          type={null}
        />
        <HeroMobileCarousel slides={slides} />
      </section>
    );
  }
  const pilot = projectPilotOgabasseyMobile({
    baseUrl: config.baseUrl,
    slot,
    tiers: resolved.tiers,
  });
  if (!pilot) {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason="hero projection is empty for the pilot arm."
      />
    );
  }
  return (
    <section
      data-pilot-lab-binding={`${binding.merchantId}/${binding.assetId}`}
      data-pilot-lab-slot={binding.slotId}
    >
      <PilotLabFlightPreload projection={pilot} />
      <PilotLabScannerLink
        arm={arm}
        binding={`${binding.merchantId}/${binding.assetId}`}
        projection={pilot}
      />
      <LabHeroMobileCarousel slides={slides} slide0Projection={pilot} />
    </section>
  );
}

export function PilotLabStorePage({
  arm,
  config,
  origin,
  store,
}: {
  arm: PilotLabArm;
  config: PilotLabConfig;
  origin: string;
  store: PilotLabStore;
}): React.JSX.Element {
  const basePath = pilotLabStoreBasePath(store);
  return (
    <main>
      <h1 className="sr-only">{`${store.storeName} pilot lab (${arm})`}</h1>
      {store.slots.map((slotId) => {
        const status = statusFor(config, store.merchantId, slotId);
        if (!status) {
          return <MissingBinding key={slotId} slotId={slotId} store={store} />;
        }
        if (slotId === 'header-logo') {
          return (
            <LabStoreHeaderSection
              key={slotId}
              arm={arm}
              basePath={basePath}
              config={config}
              status={status}
              store={store}
            />
          );
        }
        if (slotId === 'product-card') {
          return (
            <LabStoreGridSection
              key={slotId}
              arm={arm}
              basePath={basePath}
              config={config}
              origin={origin}
              status={status}
              store={store}
            />
          );
        }
        return (
          <LabStoreHeroSection
            key={slotId}
            arm={arm}
            basePath={basePath}
            config={config}
            status={status}
            store={store}
          />
        );
      })}
    </main>
  );
}
