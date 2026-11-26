import { getImageProps } from 'next/image';
import { rewriteOgabasseyTransformUrlFormat } from '@/lib/ogabassey-cdn-image-url';
import { ogabasseyFallbackImageLoader } from '@/lib/ogabassey-image-fallback-loader';
import { boundImageFormatImgProps } from '@/lib/ogabassey-image-srcset-bounds';

/**
 * Per-format `<picture>` source builder for OgaBassey CDN images.
 *
 * Cloudflare Free stores ONE body per URL and ignores `Vary: Accept`, so a
 * single Accept-negotiated `format=auto` URL cannot serve both AVIF and
 * non-AVIF clients (probe-verified 2026-07-08: a warm product variant served
 * identical AVIF bytes to AVIF, webp-only, and iOS-15/Opera-Mini Accepts).
 * The fix is client-side format selection: an explicit `format=avif` srcset
 * inside `<source type="image/avif">` plus a universally decodable
 * (png/jpeg) `<img>` fallback — each format its own URL, its own cache key.
 *
 * This helper computes both tiers from ONE `getImageProps()` pass so their
 * candidate lists stay byte-identical apart from the format token:
 *   - `imgProps`: the exact props `next/image` would render, with the paired
 *     loader emitting explicit fallback-format transform URLs for OgaBassey CDN
 *     images.
 *   - `avifSource`: the same srcset rewritten to `format=avif`, or `null`
 *     when the source is not an OgaBassey CDN transform (external/placeholder
 *     images have no AVIF tier — callers render a plain `<img>`).
 */

type GetImagePropsInput = Parameters<typeof getImageProps>[0];

export type OgabasseyImageFormatPropsInput = Omit<
  GetImagePropsInput,
  'loader'
> & {
  /**
   * Optional upper width bound applied to `w`-descriptor candidates and
   * `x`/descriptorless candidates whose URL carries a `width=` or `w=`
   * parameter. Static density/descriptorless URLs without width parameters
   * pass through unchanged.
   */
  maxSrcSetWidth?: number;
  /**
   * Optional lower width bound applied under the same URL/descriptor rules as
   * `maxSrcSetWidth`.
   */
  minSrcSetWidth?: number;
};

export interface OgabasseyAvifSourceProps {
  sizes?: string;
  srcSet: string;
}

export interface OgabasseyImageFormatProps {
  avifSource: OgabasseyAvifSourceProps | null;
  imgProps: ReturnType<typeof getImageProps>['props'];
}

/**
 * Rewrite every candidate URL in a srcset string to its `format=avif` twin.
 * Returns `null` when ANY candidate lacks an AVIF twin (non-transform URL):
 * a partial AVIF source would make AVIF-capable browsers pick a candidate
 * ladder that diverges from the fallback tier's geometry.
 *
 * Candidates are split on comma-followed-by-whitespace, NOT a bare comma: the
 * CDN transform options segment (`width=750,quality=35,format=jpeg`) contains
 * commas that are never followed by whitespace, so a bare `split(',')` would
 * shred each URL and yield no AVIF tier at all.
 */
export function buildOgabasseyAvifSrcSet(
  srcSet: string | null | undefined
): string | null {
  if (!srcSet) {
    return null;
  }

  const avifCandidates: string[] = [];
  for (const candidate of srcSet.split(/,\s+/)) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }
    const [url, ...descriptors] = trimmed.split(/\s+/);
    const avifUrl = rewriteOgabasseyTransformUrlFormat(url, 'avif');
    if (!avifUrl) {
      return null;
    }
    avifCandidates.push([avifUrl, ...descriptors].join(' '));
  }

  return avifCandidates.join(', ');
}

/**
 * Compute paired AVIF + fallback rendering props for one image. Accepts the
 * same input as `getImageProps` (minus `loader` — the app's CDN loader is
 * pinned via the shared `ogabasseyFallbackImageLoader` so test environments and
 * call sites can never diverge from what production renders).
 */
export function getOgabasseyImageFormatProps(
  input: OgabasseyImageFormatPropsInput
): OgabasseyImageFormatProps {
  const { maxSrcSetWidth, minSrcSetWidth, ...imageInput } = input;
  const { props: rawImgProps } = getImageProps({
    ...imageInput,
    loader: ogabasseyFallbackImageLoader,
  } as GetImagePropsInput);
  const imgProps = boundImageFormatImgProps(
    rawImgProps,
    minSrcSetWidth,
    maxSrcSetWidth,
    Boolean(imageInput.overrideSrc)
  );

  const avifSrcSet = buildOgabasseyAvifSrcSet(imgProps.srcSet);

  return {
    avifSource: avifSrcSet
      ? { sizes: imgProps.sizes, srcSet: avifSrcSet }
      : null,
    imgProps,
  };
}
