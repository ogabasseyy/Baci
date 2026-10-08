import 'server-only';
import { useId } from 'react';
import { preload } from 'react-dom';
import type { ProjectedCssHero } from './css-hero-adapter';
import type { ProjectedPilotImage } from './next-image-adapter';
import type { ProjectedOgabasseyMobile } from './ogabassey-mobile-adapter';

export { PilotLabNotOptimized } from './lab-not-optimized';

// Lab-only mounted consumers for the merchant image pilot. Both comparison
// arms render through these same components: the pilot arm is fed pilot
// projections over staged derivatives, the control arm is fed control
// projections over staged originals. No-op-control parity therefore holds
// by construction — only the projection input differs per arm.
//
// Only the flag-gated lab route renders these mounts. They perform no I/O,
// read no tenant state, and touch no production component, guard, shell, or
// global image configuration.

export type PilotLabArm = 'control' | 'pilot';

export interface PilotLabImageGeometry {
  sizes: string;
}

// Recorded slot geometry for generic next/image mounts, from the pilot
// packet. The OgaBassey mobile hero reuses the production hero constants
// instead so its media/sizes match the mounted renderer exactly.
const LAB_IMAGE_GEOMETRY: Readonly<Record<string, PilotLabImageGeometry>> = {
  'header-logo': { sizes: '40px' },
  'product-card': { sizes: '50vw' },
};

export function labImageGeometry(slotId: string): PilotLabImageGeometry | null {
  return LAB_IMAGE_GEOMETRY[slotId] ?? null;
}

// Flight-preload owner: the same react-dom channel the production hero
// hints use, fed by the frozen projection instead of a CDN URL. `type`
// defaults to the projection's AVIF gate; pass null for format-agnostic
// bytes (the store control hero, whose derived srcSet serves the original).
export function PilotLabFlightPreload({
  projection,
  type,
}: {
  projection: ProjectedOgabasseyMobile;
  type?: string | null;
}): null {
  preload(projection.preload.href, {
    as: 'image',
    fetchPriority: projection.preload.fetchPriority,
    imageSizes: projection.preload.imageSizes,
    imageSrcSet: projection.preload.imageSrcSet,
    media: projection.preload.media,
    type: type === undefined ? projection.preload.type : (type ?? undefined),
  });
  return null;
}

// Scanner-visible twin of the flight preload: same attributes, discoverable
// during HTML parse. `binding` ("merchantId/assetId") is the served-gate
// pairing identity: React hoists this link to <head>, so the gate pairs it
// with its section picture by binding, never by subtree position.
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

// Priority-card preload owner: flight-only, like the production card it
// mirrors (next/image's `preload` prop hoists exactly one head link — no
// scanner twin). AVIF-only typed srcSet; WebP is discovered from markup by
// non-AVIF browsers, so preloading both formats can never double-fetch.
// Rendered by the store page (server), never by the client card clone.
export function PilotLabCardPreload({
  projection,
}: {
  projection: ProjectedPilotImage;
}): null {
  const avif = projection.sources.find((source) => source.format === 'avif');
  if (!avif) {
    preload(projection.fallbackSrc, {
      as: 'image',
      fetchPriority: 'high',
      imageSizes: projection.sizes,
    });
    return null;
  }
  // buildPilotSrcSet sorts ascending, so the first candidate is the
  // smallest tier — the href fallback for prefetch-only consumers.
  const href = avif.srcSet.split(',')[0]?.split(' ')[0] ?? '';
  preload(href, {
    as: 'image',
    fetchPriority: 'high',
    imageSizes: projection.sizes,
    imageSrcSet: avif.srcSet,
    type: 'image/avif',
  });
  return null;
}

// Rendered-picture owner: same structure as the mounted mobile hero picture
// (AVIF source, fallback source, transparent-pixel img). `type` defaults
// to the AVIF gate; pass null for format-agnostic bytes (the control arm
// serves the original in every candidate, so a type gate would lie).
export function PilotLabMobilePicture({
  arm,
  projection,
  type,
}: {
  arm: PilotLabArm;
  projection: ProjectedOgabasseyMobile;
  type?: string | null;
}): React.JSX.Element {
  return (
    <picture data-pilot-lab-picture={arm}>
      <source
        media={projection.media}
        sizes={projection.sizes}
        srcSet={projection.avifSrcSet}
        type={type === undefined ? 'image/avif' : (type ?? undefined)}
      />
      <source
        media={projection.media}
        sizes={projection.sizes}
        srcSet={projection.fallbackSrcSet}
      />
      <img
        alt={projection.alt}
        decoding="sync"
        fetchPriority="high"
        loading="eager"
        src={projection.imgSrc}
        className={`h-full w-full ${
          projection.imageFit === 'contain'
            ? 'object-contain object-right'
            : 'object-cover'
        }`}
      />
    </picture>
  );
}

// One mount for both arms: all three hint owners consume the same rendered
// projection, so preload matching dedupes them into one fetch. `type`
// passes through to both hint owners AND the rendered picture (the gallery
// control arm serves format-agnostic bytes, so it omits the AVIF gate like
// the store pages — including the picture source, which would otherwise
// type the original as AVIF and break decoding in AVIF-capable browsers).
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

// Generic next/image-slot mount: one <picture> with a <source> per projected
// format over the shared slot sizes.
export function PilotLabPictureMount({
  arm,
  projection,
}: {
  arm: PilotLabArm;
  projection: ProjectedPilotImage;
}): React.JSX.Element {
  return (
    <picture data-pilot-lab-picture={arm}>
      {projection.sources.map((source) => (
        <source
          key={source.format}
          sizes={projection.sizes}
          srcSet={source.srcSet}
          type={`image/${source.format}`}
        />
      ))}
      <img
        alt={projection.alt}
        decoding="async"
        fetchPriority={projection.fetchPriority}
        height={projection.height}
        loading={projection.loading}
        sizes={projection.sizes}
        src={projection.fallbackSrc}
        width={projection.width}
      />
    </picture>
  );
}

// Lab twin of the builder CSS-background hero: one layer per breakpoint,
// each selecting between the staged AVIF and WebP tiers. Breakpoint images
// load ONLY inside their media query: a scoped <style> block gates every
// layer, so viewports download exactly the tiers they render (inline
// background-images would fetch every breakpoint at every viewport).
const CSS_MEDIA_PATTERN = /^[\w\s().,/:*+-]+$/;

export function PilotLabCssHeroMount({
  projection,
}: {
  projection: ProjectedCssHero;
}): React.JSX.Element {
  const scope = `plab-css-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  for (const breakpoint of projection.breakpoints) {
    if (!CSS_MEDIA_PATTERN.test(breakpoint.media)) {
      throw new Error(
        `merchant image pilot: refusing to emit unscoped CSS media "${breakpoint.media}"`
      );
    }
  }
  const rules = projection.breakpoints
    .map((breakpoint, index) => {
      // Format-honest control: identical URLs mean one original file, so a
      // typed image-set would gate undecodable bytes behind AVIF/WebP
      // claims. Emit the plain url() alone instead.
      const image =
        breakpoint.avifUrl === breakpoint.webpUrl
          ? `background-image:url("${breakpoint.webpUrl}");`
          : `background-image:url("${breakpoint.webpUrl}");background-image:image-set(url("${breakpoint.avifUrl}") type("image/avif"),url("${breakpoint.webpUrl}") type("image/webp"));`;
      return `@media ${breakpoint.media}{.${scope} .plab-css-layer-${index}{${image}background-size:${projection.cover ? 'cover' : 'auto'};}}`;
    })
    .join('');
  return (
    <div data-pilot-lab-css-hero="true" className={scope}>
      <style>{rules}</style>
      {projection.breakpoints.map((breakpoint, index) => (
        <div
          key={breakpoint.media}
          data-pilot-lab-css-layer={breakpoint.media}
          className={`plab-css-layer-${index}`}
        />
      ))}
    </div>
  );
}
