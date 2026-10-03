import { notFound } from 'next/navigation';
import {
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_SOURCE_MEDIA,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import {
  isPilotLabEnabled,
  type PilotLabConfig,
} from '@/lib/merchant-image-variant-pilot/lab-config';
import type { PilotBindingStatus } from '@/lib/merchant-image-variant-pilot/lab-index';
import {
  labImageGeometry,
  type PilotLabArm,
  PilotLabMobileMount,
  PilotLabNotOptimized,
  PilotLabPictureMount,
} from '@/lib/merchant-image-variant-pilot/lab-mount';
import {
  projectControlNextImage,
  projectPilotNextImage,
} from '@/lib/merchant-image-variant-pilot/next-image-adapter';
import {
  projectControlOgabasseyMobile,
  projectPilotOgabasseyMobile,
} from '@/lib/merchant-image-variant-pilot/ogabassey-mobile-adapter';
import { resolvePilotSlot } from '@/lib/merchant-image-variant-pilot/resolver';
import { getLabConfig } from './lab-route';

// Lab-only comparison entrypoint for the merchant image pilot. One arm per
// render (`?arm=pilot` default, `?arm=control`) so matched browser runs load
// exactly one variant set. Production defaults are preserved: without
// BACI_IMAGE_PILOT_LAB=1 this route is a 404 and stages nothing.
//
// Request rendering performs only guarded in-memory lookups over the frozen
// lab index. Staging (copying verified derivatives + originals under
// /__pilot) runs once per frozen input content — never per shopper request,
// and this route is never linked from production. Local bytes only:
// input/output roots must point at the operator's gitignored pilot
// directories.
//
// No `dynamic`/`revalidate` segment exports: the app runs with
// `cacheComponents` (see next.config.ts), which rejects them at compile
// time. This route reads request-time input (searchParams + the lab index
// load), so it declares `instant = false` — the route-scoped,
// cacheComponents-era way to allow request rendering without touching the
// global cacheComponents setting.
export const instant = false;

function LabBinding({
  arm,
  config,
  status,
}: {
  arm: PilotLabArm;
  config: PilotLabConfig;
  status: PilotBindingStatus;
}): React.JSX.Element {
  const { binding } = status;
  if (status.status !== 'accepted') {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason={`binding status "${status.status}"${status.detail ? `: ${status.detail}` : ''}; the control path is retained and this slot is excluded from the optimized denominator.`}
      />
    );
  }
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
  if (!resolved || !stagedOriginal) {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason="accepted binding has no staged tiers or original; refusing to render rather than mixing arms."
      />
    );
  }
  if (binding.role === 'hero') {
    const slot = {
      alt: `${binding.assetId} lab hero`,
      imageFit: 'contain' as const,
      media: MOBILE_HERO_SOURCE_MEDIA,
      sizes: MOBILE_HERO_IMAGE_SIZES,
    };
    const projection =
      arm === 'pilot'
        ? projectPilotOgabasseyMobile({
            baseUrl: config.baseUrl,
            slot,
            tiers: resolved.tiers,
          })
        : projectControlOgabasseyMobile({ originalUrl: stagedOriginal, slot });
    if (!projection) {
      return (
        <PilotLabNotOptimized
          binding={binding}
          reason="hero projection is empty for this arm."
        />
      );
    }
    return (
      <section
        data-pilot-lab-binding={`${binding.merchantId}/${binding.assetId}`}
        data-pilot-lab-slot={binding.slotId}
      >
        <h2>
          {binding.slotId} · {binding.assetId} ({arm})
        </h2>
        <PilotLabMobileMount
          arm={arm}
          binding={`${binding.merchantId}/${binding.assetId}`}
          projection={projection}
          type={arm === 'control' ? null : undefined}
        />
      </section>
    );
  }
  const geometry = labImageGeometry(binding.slotId);
  if (!geometry) {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason={`slot "${binding.slotId}" has no recorded lab geometry; uncovered slots are reported, not silently omitted.`}
      />
    );
  }
  const largest = [...resolved.tiers].sort(
    (left, right) => right.width - left.width
  )[0];
  if (!largest) {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason="accepted binding has no tiers."
      />
    );
  }
  const slot = {
    alt: `${binding.assetId} lab image`,
    fetchPriority: 'auto' as const,
    height: largest.height,
    loading: 'lazy' as const,
    sizes: geometry.sizes,
    width: largest.width,
  };
  const projection =
    arm === 'pilot'
      ? projectPilotNextImage({
          baseUrl: config.baseUrl,
          slot,
          tiers: resolved.tiers,
        })
      : projectControlNextImage({ originalUrl: stagedOriginal, slot });
  if (!projection) {
    return (
      <PilotLabNotOptimized
        binding={binding}
        reason="image projection is empty for this arm."
      />
    );
  }
  return (
    <section
      data-pilot-lab-binding={`${binding.merchantId}/${binding.assetId}`}
      data-pilot-lab-slot={binding.slotId}
    >
      <h2>
        {binding.slotId} · {binding.assetId} ({arm})
      </h2>
      <PilotLabPictureMount arm={arm} projection={projection} />
    </section>
  );
}

export default async function PilotLabPage({
  searchParams,
}: {
  searchParams: Promise<{ arm?: string }>;
}): Promise<React.JSX.Element> {
  if (!isPilotLabEnabled()) {
    notFound();
  }
  const params = await searchParams;
  const arm: PilotLabArm = params.arm === 'control' ? 'control' : 'pilot';
  const config = await getLabConfig();
  return (
    <main data-pilot-lab-arm={arm}>
      <h1>Merchant image pilot lab — {arm} arm</h1>
      <p>
        Lab comparison only: the pilot arm serves staged derivatives, the
        control arm serves staged originals, both from the same lab asset
        origin. Slots without a verified acceptance stay on the reported
        not-optimized path.
      </p>
      {config.statuses.map((status) => (
        <LabBinding
          key={`${status.binding.merchantId}/${status.binding.assetId}/${status.binding.slotId}`}
          arm={arm}
          config={config}
          status={status}
        />
      ))}
    </main>
  );
}
