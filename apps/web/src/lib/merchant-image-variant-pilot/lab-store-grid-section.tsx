import type { PilotLabConfig } from './lab-config';
import {
  labCardSlot,
  labProductFixture,
  pilotLabFillerImageUrl,
} from './lab-fixtures';
import type { PilotBindingStatus } from './lab-index';
import {
  type PilotLabArm,
  PilotLabCardPreload,
  PilotLabNotOptimized,
} from './lab-mount';
import type { PilotLabStore } from './lab-store-registry';
import { resolveBinding } from './lab-store-resolve';
import { type LabGridFiller, LabStoreGrid } from './lab-store-shells';
import { projectPilotNextImage } from './next-image-adapter';

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

export function LabStoreGridSection({
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
