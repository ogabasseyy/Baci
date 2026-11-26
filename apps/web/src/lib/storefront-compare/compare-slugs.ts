import { generateSlug } from '../seo-utils';
import type { ParsedCompareSlug } from './compare-types';

const COMPARE_DELIMITER = '-vs-';
const COMPARE_ESCAPE_PREFIX = '~';

function shouldEscapeCompareKey(key: string) {
  return (
    key.includes(COMPARE_DELIMITER) || key.startsWith(COMPARE_ESCAPE_PREFIX)
  );
}

function encodeCompareKey(key: string) {
  if (!shouldEscapeCompareKey(key)) {
    return key;
  }

  const bytes = new TextEncoder().encode(key);
  const encodedBytes = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

  return `${COMPARE_ESCAPE_PREFIX}${encodedBytes}`;
}

function decodeCompareKey(key: string) {
  if (!key.startsWith(COMPARE_ESCAPE_PREFIX)) {
    return key;
  }

  const encodedBytes = key.slice(COMPARE_ESCAPE_PREFIX.length);

  if (
    encodedBytes.length === 0 ||
    encodedBytes.length % 2 !== 0 ||
    /[^0-9a-f]/i.test(encodedBytes)
  ) {
    return null;
  }

  const bytes = new Uint8Array(
    encodedBytes.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []
  );

  try {
    const decoded = new TextDecoder().decode(bytes);
    return shouldEscapeCompareKey(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function buildCanonicalCompareSlug(left: string, right: string) {
  return [left, right].sort().map(encodeCompareKey).join(COMPARE_DELIMITER);
}

export function buildCanonicalProductCompareSlug(
  left: string,
  right: string
): string {
  return buildCanonicalCompareSlug(left, right);
}

export function buildCanonicalBrandCompareSlug(
  left: string,
  right: string
): string {
  return buildCanonicalCompareSlug(generateSlug(left), generateSlug(right));
}

export function parseCompareSlug(slug: string): ParsedCompareSlug | null {
  const [leftPart, rightPart, ...rest] = slug.split(COMPARE_DELIMITER);

  if (!leftPart || !rightPart || rest.length > 0) {
    return null;
  }

  const leftKey = decodeCompareKey(leftPart);
  const rightKey = decodeCompareKey(rightPart);

  if (!leftKey || !rightKey) {
    return null;
  }

  return {
    leftKey,
    rightKey,
    canonicalSlug: buildCanonicalCompareSlug(leftKey, rightKey),
  };
}
