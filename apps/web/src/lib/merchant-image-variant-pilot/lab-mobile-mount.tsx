import 'server-only';
import type { PilotLabArm } from './lab-arm';
import { PilotLabFlightPreload } from './lab-flight-preload';
import { PilotLabMobilePicture } from './lab-mobile-picture';
import { PilotLabScannerLink } from './lab-scanner-link';
import type { ProjectedOgabasseyMobile } from './ogabassey-mobile-adapter';

// One mount for both arms: all three hint owners consume the same rendered
// projection, so preload matching dedupes them into one fetch. `type`
// passes through to both hint owners AND the rendered picture (the gallery
// control arm serves format-agnostic bytes, so it omits the AVIF gate like
// the store pages — including the picture source, which would otherwise
// type the original as AVIF and break decoding in AVIF-capable browsers).
//
// Lab-only: only the flag-gated lab route renders these mounts. They
// perform no I/O, read no tenant state, and touch no production
// component, guard, shell, or global image configuration.
export function PilotLabMobileMount({
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
    <>
      <PilotLabFlightPreload projection={projection} type={type} />
      <PilotLabScannerLink
        arm={arm}
        binding={binding}
        projection={projection}
        type={type}
      />
      <PilotLabMobilePicture arm={arm} projection={projection} type={type} />
    </>
  );
}
