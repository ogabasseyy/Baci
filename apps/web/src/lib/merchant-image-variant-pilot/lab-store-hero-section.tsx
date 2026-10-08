import { HeroMobileCarousel } from '@/components/storefront/ogabassey/components/hero-mobile-carousel';
import type { PilotLabArm } from './lab-arm';
import type { PilotLabConfig } from './lab-config';
import { labHeroSlides, labHeroSlot } from './lab-fixtures';
import { PilotLabFlightPreload } from './lab-flight-preload';
import { LabHeroMobileCarousel } from './lab-hero-clone';
import type { PilotBindingStatus } from './lab-index';
import { PilotLabNotOptimized } from './lab-not-optimized';
import { PilotLabScannerLink } from './lab-scanner-link';
import { deriveControlHeroHint } from './lab-store-hero-hint';
import type { PilotLabStore } from './lab-store-registry';
import { resolveBinding } from './lab-store-resolve';
import {
  projectControlOgabasseyMobile,
  projectPilotOgabasseyMobile,
} from './ogabassey-mobile-adapter';

export function LabStoreHeroSection({
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
    const stagedOriginal = config.originalUrlFor({
      merchantId: binding.merchantId,
      slotId: binding.slotId,
    });
    return (
      <PilotLabNotOptimized
        baselineSrc={stagedOriginal}
        binding={binding}
        reason={`binding status "${status.status}"${status.detail ? `: ${status.detail}` : ''}; the control path is retained and this slot is excluded from the optimized denominator.`}
      />
    );
  }
  const { resolved, stagedOriginal } = resolveBinding(config, binding);
  if (!resolved || !stagedOriginal) {
    return (
      <PilotLabNotOptimized
        baselineSrc={stagedOriginal}
        binding={binding}
        reason="binding has no staged tiers or verified original; refusing to render rather than mixing arms."
      />
    );
  }
  const heroAlt = `${binding.assetId} lab hero`;
  const slides = labHeroSlides({
    arm,
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
