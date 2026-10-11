'use client';

import { HeaderLogo } from '@/components/storefront/blocks/header-logo';
import type { PilotLabArm } from './lab-arm';
import { LabHeaderLogo } from './lab-header-logo';
import { LabStoreHeader } from './lab-store-header';
import type { ProjectedPilotImage } from './next-image-adapter';

// Lab-only client header shell for the per-store pages (the grid shell
// lives in lab-store-grid.tsx under the repo one-export rule). Server
// components cannot pass function props (getHref, cart handlers) to
// client components, so the shell owns every callback and stays
// serializable at the server boundary: data in, no closures out. Both
// arms render the same shell; only the mounted image component differs.

// Lab-scoped hrefs: store pages never link production. PDP/cart hrefs stay
// inside the lab route so crawlers and matched runs cannot escape it.
// Every link preserves the arm: without ?arm= the destination renders
// the pilot default, silently flipping a control session mid-browse.
function labHref(basePath: string, path: string, arm: PilotLabArm): string {
  return `${basePath}${path}?arm=${arm}`;
}

export function LabStoreHeaderBar({
  arm,
  basePath,
  layout,
  projection,
  stagedOriginal,
  storeName,
}: {
  arm: PilotLabArm;
  basePath: string;
  layout: 'logo-left-nav-center' | 'logo-left-nav-right' | 'logo-center';
  // Pilot arm only; the control arm renders the original with the staged URL.
  projection: ProjectedPilotImage | null;
  stagedOriginal: string;
  storeName: string;
}) {
  const getHref = (path: string) => labHref(basePath, path, arm);
  return (
    <LabStoreHeader storeName={storeName}>
      {arm === 'pilot' && projection ? (
        <LabHeaderLogo
          getHref={getHref}
          layout={layout}
          projection={projection}
          storeName={storeName}
        />
      ) : (
        <HeaderLogo
          storeName={storeName}
          getHref={getHref}
          layout={layout}
          logoUrl={stagedOriginal}
        />
      )}
    </LabStoreHeader>
  );
}
