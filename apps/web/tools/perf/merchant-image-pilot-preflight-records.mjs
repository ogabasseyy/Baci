// Preflight record mirrors: inventory/acceptance shape checks that must
// agree with the lab route's contracts (offline must never report ok for
// inputs the route rejects).
import {
  ACCEPTANCE_KEYS,
  ASSET_ID,
  HEX64,
  isRouteDatetime,
  ROLES,
  UUID,
} from './merchant-image-pilot-preflight-shared.mjs';

export function acceptanceKey(record) {
  return `${record.merchantId}/${record.assetId}`;
}

export function sameAcceptance(left, right) {
  // Positional, mirroring the route's buildLabIndex dedupe: outputHashes
  // pins each rung positionally, so a reordered duplicate is a
  // conflicting record, not the same acceptance.
  return (
    left.generationId === right.generationId &&
    left.verdict === right.verdict &&
    left.recipeId === right.recipeId &&
    left.sourceSha256 === right.sourceSha256 &&
    left.originalUrl === right.originalUrl &&
    left.outputHashes.length === right.outputHashes.length &&
    left.outputHashes.every((hash, index) => hash === right.outputHashes[index])
  );
}

// Mirror of lab-config originalFileName: the staged original name is derived
// from the binding plus the decode-verified manifest format — never the
// operator-controlled inventory filename, which may lie about the bytes.
// Callers pass manifest.source.format only after the manifest stage has
// proved it equals the sharp-decoded format. Unknown formats fail closed,
// exactly like the loader: there is no correct suffix for them.
const STAGED_ORIGINAL_EXTENSION_FOR_FORMAT = {
  avif: '.avif',
  gif: '.gif',
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  svg: '.svg',
  webp: '.webp',
};

export function stagedOriginalName(binding, sourceFormat) {
  const extension =
    STAGED_ORIGINAL_EXTENSION_FOR_FORMAT[String(sourceFormat).toLowerCase()];
  if (!extension) {
    throw new Error(
      `preflight: cannot name a staged original with format "${sourceFormat}" (no servable suffix)`
    );
  }
  return `${binding.merchantId}-${binding.assetId}${extension}`;
}

// Mirror of the route's binding contract (parsePilotInventoryBinding):
// assetId charset, http(s) source URL. Record-shape fields (slot,
// sourcePath, sha256) keep the standalone record checks.
export function validInventoryRecord(record) {
  return (
    record &&
    typeof record === 'object' &&
    UUID.test(record.merchantId ?? '') &&
    ASSET_ID.test(record.assetId ?? '') &&
    ROLES.has(record.role) &&
    typeof record.slot === 'string' &&
    record.slot.length > 0 &&
    record.slot.length <= 128 &&
    HEX64.test(record.sha256 ?? '') &&
    isSafeRelativePath(record.sourcePath) &&
    isHttpUrl(record.url)
  );
}

// Exact mirror of lab-route isSafeRelativePath: 1-256 chars, no
// backslashes, no control characters, no encoded separators, no
// empty/dot/dot-dot segments. Offline must never report ok for an
// inventory the route rejects.
const ENCODED_SEPARATOR_PATTERN = /%(2f|5c|00)/i;

function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

// Every decode layer (capped): %252f (double) and deeper nestings must
// not smuggle separators past the single-pattern check — intermediates
// matter, not just the fixpoint. Malformed sequences stop decoding and
// validate as-is; overlong-UTF-8 forms that no decoder accepts stay
// blocked downstream by realpath confinement.
function decodeLayers(value) {
  const layers = [value];
  let current = value;
  for (let depth = 0; depth < 8; depth += 1) {
    let next = current;
    try {
      next = decodeURIComponent(current);
    } catch {
      return layers;
    }
    if (next === current) {
      return layers;
    }
    layers.push(next);
    current = next;
  }
  return layers;
}

export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    return false;
  }
  return decodeLayers(value).every((layer) => {
    if (
      layer.startsWith('/') ||
      layer.includes('\\') ||
      hasControlCharacter(layer) ||
      ENCODED_SEPARATOR_PATTERN.test(layer)
    ) {
      return false;
    }
    return !layer
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..');
  });
}

export function isHttpUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validAcceptanceShape(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return false;
  }
  const keys = Object.keys(record);
  if (
    keys.length !== ACCEPTANCE_KEYS.size ||
    keys.some((key) => !ACCEPTANCE_KEYS.has(key))
  ) {
    return false;
  }
  const text = (value, max) =>
    typeof value === 'string' && value.length > 0 && value.length <= max;
  return (
    UUID.test(record.merchantId ?? '') &&
    text(record.assetId, 128) &&
    HEX64.test(record.generationId ?? '') &&
    text(record.recipeId, 64) &&
    (record.verdict === 'accepted' || record.verdict === 'rejected') &&
    HEX64.test(record.sourceSha256 ?? '') &&
    isHttpUrl(record.originalUrl) &&
    Array.isArray(record.outputHashes) &&
    record.outputHashes.length > 0 &&
    record.outputHashes.length <= 24 &&
    record.outputHashes.every((hash) => HEX64.test(hash ?? '')) &&
    text(record.note, 500) &&
    text(record.reviewer, 128) &&
    isRouteDatetime(record.reviewedAt) &&
    record.schemaVersion === 1
  );
}
