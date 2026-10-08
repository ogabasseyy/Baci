import 'server-only';
import type { PilotLabConfig } from './lab-config';
import type { PilotBindingStatus } from './lab-index';
import { type PilotLabArm, PilotLabNotOptimized } from './lab-mount';
import { LabStoreGridSection } from './lab-store-grid-section';
import { LabStoreHeroSection } from './lab-store-hero-section';
import {
  type PilotLabStore,
  type PilotLabUncoveredSlot,
  pilotLabStoreBasePath,
} from './lab-store-registry';
import { resolveBinding, statusFor } from './lab-store-resolve';
import { LabStoreHeaderBar } from './lab-store-shells';
import { projectPilotNextImage } from './next-image-adapter';

export { deriveControlHeroHint } from './lab-store-hero-hint';
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
// lab-store-hero-hint.ts). The gallery (/pilot-lab) remains as a projection
// fixture aid; CWV claims may only come from these store pages.
//
// Layout: the registry, hero hint, resolve helpers, and grid/hero sections
// live in sibling modules (each file under the 300-line repo ceiling);
// this file keeps the header section, the missing-binding fallback, the
// page composer, and re-exports for existing importers.
export {
  PILOT_LAB_STORES,
  type PilotLabSlotId,
  type PilotLabStore,
  type PilotLabUncoveredSlot,
  pilotLabStoreBasePath,
  pilotLabStoreBySlug,
} from './lab-store-registry';

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

function UncoveredConsumer({
  store,
  uncovered,
}: {
  store: PilotLabStore;
  uncovered: PilotLabUncoveredSlot;
}): React.JSX.Element {
  // Explicitly reported, never silently excluded: the section carries no
  // binding (mount gates skip it) but its status lands in the served
  // coverage `reported` rows and the readiness slot geometry, naming the
  // consumer the sample does not exercise.
  return (
    <section
      data-pilot-lab-slot={uncovered.slotId}
      data-pilot-lab-status="uncovered-consumer"
    >
      <h2>{uncovered.slotId} — uncovered consumer</h2>
      <p>
        {`store "${store.slug}" consumer "${uncovered.consumer}" has no sampled binding (${uncovered.reason}); excluded from every denominator by declaration, not by omission.`}
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
      {store.uncoveredSlots.map((uncovered) => (
        <UncoveredConsumer
          key={uncovered.slotId}
          store={store}
          uncovered={uncovered}
        />
      ))}
    </main>
  );
}
