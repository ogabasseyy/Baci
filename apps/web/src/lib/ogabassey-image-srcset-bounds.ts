import type { getImageProps } from 'next/image';
import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';

const OGABASSEY_CDN_HOSTNAME = new URL(DEFAULT_MEDIA_CDN_ORIGIN).hostname;
const SAME_ORIGIN_CDN_PREFIX = '/cdn-image/';
const CDN_TRANSFORM_PREFIX = '/image/';
const CDN_TRANSFORM_WIDTH_PATTERN = /(^|,)(width=)(\d+)(?=,|$)/;
const QUERY_WIDTH_PATTERN = /(^|&)(w=)(\d+)(?=&|$)/;

type ImageProps = ReturnType<typeof getImageProps>['props'];

interface ParsedSrcSetCandidate {
  descriptor: string | null;
  isWidthDescriptor: boolean;
  raw: string;
  url: string;
  width: number;
}

interface LocatedCandidateWidth {
  replace: (width: number) => string;
  width: number;
}

function locateTransformOptionsWidth(
  url: string
): LocatedCandidateWidth | null {
  let prefixEnd = -1;
  if (url.startsWith(SAME_ORIGIN_CDN_PREFIX)) {
    prefixEnd = SAME_ORIGIN_CDN_PREFIX.length;
  } else {
    try {
      const parsed = new URL(url);
      const cdnPrefix = `${parsed.origin}${CDN_TRANSFORM_PREFIX}`;
      if (
        parsed.hostname === OGABASSEY_CDN_HOSTNAME &&
        url.startsWith(cdnPrefix)
      ) {
        prefixEnd = cdnPrefix.length;
      }
    } catch {
      return null;
    }
  }
  if (prefixEnd < 0) {
    return null;
  }

  const remainder = url.slice(prefixEnd);
  const separatorIndex = remainder.indexOf('/');
  if (separatorIndex <= 0) {
    return null;
  }
  const optionsSegment = remainder.slice(0, separatorIndex);
  const match = optionsSegment.match(CDN_TRANSFORM_WIDTH_PATTERN);
  const width = match ? Number.parseInt(match[3], 10) : Number.NaN;
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  const before = url.slice(0, prefixEnd);
  const after = remainder.slice(separatorIndex);
  return {
    replace: (nextWidth) =>
      `${before}${optionsSegment.replace(CDN_TRANSFORM_WIDTH_PATTERN, `$1$2${nextWidth}`)}${after}`,
    width,
  };
}

function locateQueryWidth(url: string): LocatedCandidateWidth | null {
  const hashIndex = url.indexOf('#');
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = base.indexOf('?');
  if (queryIndex < 0) {
    return null;
  }
  const query = base.slice(queryIndex + 1);
  const match = query.match(QUERY_WIDTH_PATTERN);
  const width = match ? Number.parseInt(match[3], 10) : Number.NaN;
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  const path = base.slice(0, queryIndex);
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  return {
    replace: (nextWidth) =>
      `${path}?${query.replace(QUERY_WIDTH_PATTERN, `$1$2${nextWidth}`)}${hash}`,
    width,
  };
}

function locateCandidateWidth(url: string): LocatedCandidateWidth | null {
  return locateTransformOptionsWidth(url) ?? locateQueryWidth(url);
}

function parseSrcSetWidthCandidates(
  srcSet: string
): ParsedSrcSetCandidate[] | null {
  const candidates: ParsedSrcSetCandidate[] = [];
  for (const entry of srcSet.split(/,\s+/)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.match(/^(\S+)(?:\s+(\S+))?$/);
    if (!parts) {
      return null;
    }
    const [, url, descriptor = null] = parts;
    const widthDescriptor = descriptor?.match(/^(\d+)w$/i);
    const width = widthDescriptor
      ? Number.parseInt(widthDescriptor[1], 10)
      : (locateCandidateWidth(url)?.width ?? null);
    if (width === null || !Number.isFinite(width) || width <= 0) {
      return null;
    }
    candidates.push({
      descriptor,
      isWidthDescriptor: Boolean(widthDescriptor),
      raw: trimmed,
      url,
      width,
    });
  }
  return candidates.length > 0 ? candidates : null;
}

function clampCandidateToMaxWidth(
  candidate: ParsedSrcSetCandidate,
  maxWidth: number
): ParsedSrcSetCandidate {
  const url =
    locateCandidateWidth(candidate.url)?.replace(maxWidth) ?? candidate.url;
  const descriptor = candidate.isWidthDescriptor
    ? `${maxWidth}w`
    : candidate.descriptor;
  return {
    descriptor,
    isWidthDescriptor: candidate.isWidthDescriptor,
    raw: descriptor ? `${url} ${descriptor}` : url,
    url,
    width: maxWidth,
  };
}

function normalizeWidthBound(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/**
 * Filter `imgProps.srcSet` (and clamp `imgProps.src` when an upper bound trims
 * candidates) to `[minSrcSetWidth, maxSrcSetWidth]`. Applies to `w`-descriptor
 * ladders as well as `x`/descriptorless candidates whose URL carries a CDN
 * transform `width=` option or loader query `w=` parameter.
 */
export function boundImageFormatImgProps(
  imgProps: ImageProps,
  minSrcSetWidth?: number,
  maxSrcSetWidth?: number,
  hasOverrideSrc = false
): ImageProps {
  const minWidth = normalizeWidthBound(minSrcSetWidth);
  const maxWidth = normalizeWidthBound(maxSrcSetWidth);
  if ((minWidth === undefined && maxWidth === undefined) || !imgProps.srcSet) {
    return imgProps;
  }

  const parsed = parseSrcSetWidthCandidates(imgProps.srcSet);
  if (!parsed) {
    return imgProps;
  }

  const sorted = [...parsed].sort((a, b) => a.width - b.width);
  const underMax =
    maxWidth !== undefined
      ? sorted.filter((candidate) => candidate.width <= maxWidth)
      : sorted;
  const boundedMax =
    underMax.length > 0
      ? underMax
      : maxWidth !== undefined
        ? [clampCandidateToMaxWidth(sorted[0], maxWidth)]
        : sorted;
  const aboveMin =
    minWidth !== undefined
      ? boundedMax.filter((candidate) => candidate.width >= minWidth)
      : boundedMax;
  const bounded = aboveMin.length > 0 ? aboveMin : boundedMax;
  const wasTopCapped =
    !hasOverrideSrc &&
    maxWidth !== undefined &&
    sorted[sorted.length - 1].width > maxWidth;

  return {
    ...imgProps,
    src: wasTopCapped ? bounded[bounded.length - 1].url : imgProps.src,
    srcSet: bounded.map((candidate) => candidate.raw).join(', '),
  };
}
