import 'server-only';
import type { PilotLabArm } from './lab-arm';
import type { ProjectedOgabasseyMobile } from './ogabassey-mobile-adapter';

// Scanner-visible twin of the flight preload: same attributes, discoverable
// during HTML parse. `binding` ("merchantId/assetId") is the served-gate
// pairing identity: React hoists this link to <head>, so the gate pairs it
// with its section picture by binding, never by subtree position.
//
// Lab-only: only the flag-gated lab route renders these mounts. They
// perform no I/O, read no tenant state, and touch no production
// component, guard, shell, or global image configuration.
export function PilotLabScannerLink({
  arm,
  binding,
  projection,
  type,
}: {
  arm: PilotLabArm;
  binding: string;
  projection: ProjectedOgabasseyMobile;
  type?: string | null;
}): React.JSX.Element {
  return (
    <link
      rel="preload"
      as="image"
      data-pilot-lab-binding={binding}
      href={projection.preload.href}
      imageSrcSet={projection.preload.imageSrcSet}
      imageSizes={projection.preload.imageSizes}
      media={projection.preload.media}
      fetchPriority={projection.preload.fetchPriority}
      type={type === undefined ? projection.preload.type : (type ?? undefined)}
      data-pilot-lab-preload={arm}
    />
  );
}
