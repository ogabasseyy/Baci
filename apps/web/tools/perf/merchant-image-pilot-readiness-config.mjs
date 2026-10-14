// Readiness gate input config: CLI parsing plus the required browser
// profile matrix. The gate must qualify every profile that selects
// different image tiers or lays out differently — the spec coverage
// matrix (design 2026-10-01: mobile 360/390/412 at DPR 1/2/3, desktop
// 1365 at DPR 1/2) — never a single hardcoded viewport.
//
// Every CLI token must be a known --key=value: a typoed flag (or a stray
// value from a space-separated `--flag value`) is rejected instead of
// silently dropped, so a green report always proves the matrix the caller
// meant to configure.
import { MAX_INVENTORY_BYTES } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import sampleStores from './merchant-image-pilot-lab-stores.json' with {
  type: 'json',
};
import { readUpToBytes } from './merchant-image-pilot-preflight-shared.mjs';

export const READINESS_CLI_OPTIONS = [
  'chrome',
  'hero-stores',
  'mounts',
  'origin',
  'profiles',
  'public-dir',
  'store-map',
];

export const SETTINGS_CLI_OPTIONS = [
  'browser-provenance',
  'browser-version',
  'cache-provenance',
  'expect-cpu-slowdown',
  'expect-chrome-major',
  'expect-connectivity',
  'expect-download-kbps',
  'expect-dpr',
  'expect-form-factor',
  'expect-iterations',
  'expect-lh-dpr',
  'expect-lh-viewport',
  'expect-request-latency-ms',
  'expect-route',
  'expect-rtt-ms',
  'expect-throttling-method',
  'expect-throughput-kbps',
  'expect-upload-kbps',
  'expect-viewport',
  'har',
  'lighthouse',
  'screenshot',
  'screenshot-provenance',
];

export function parseArgs(argv, allowed) {
  const allow = new Set(allowed ?? []);
  const args = {};
  for (const token of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(token);
    if (!match) {
      throw new Error(
        `bad argument "${token}": expected --key=value (allowed: ${[...allow].map((key) => `--${key}`).join(', ')})`
      );
    }
    if (!allow.has(match[1])) {
      throw new Error(
        `unknown option --${match[1]} (allowed: ${[...allow].map((key) => `--${key}`).join(', ')})`
      );
    }
    // A repeated option is conflicting intent, not an override: silently
    // keeping the last value would certify a profile the caller did not
    // mean (--expect-dpr=3 --expect-dpr=2 must not pass as DPR-2).
    if (match[1] in args) {
      throw new Error(`duplicate option --${match[1]}`);
    }
    args[match[1]] = match[2];
  }
  return args;
}

export function parseStoreMap(
  value,
  expectedMounts = null,
  requiredMerchantIds = null
) {
  const stores = String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [merchantId, slug] = entry.split('=');
      if (!merchantId || !slug) {
        throw new Error(`bad --store-map entry: ${entry}`);
      }
      return { merchantId, slug };
    });
  // An empty map would run zero browser checks and still report ok, so
  // it is a usage error, not an empty loop.
  if (stores.length === 0) {
    throw new Error(
      'bad --store-map: expected at least one merchant=slug entry'
    );
  }
  const seen = new Set();
  for (const store of stores) {
    if (seen.has(store.merchantId)) {
      throw new Error(
        `bad --store-map: merchant "${store.merchantId}" maps to more than one store`
      );
    }
    seen.add(store.merchantId);
  }
  // Every merchant with expected mounts needs exactly one mapped store:
  // omitted merchants would otherwise skip all browser checks silently.
  if (expectedMounts !== null) {
    const uncovered = [
      ...new Set(expectedMounts.map((mount) => mount.merchantId)),
    ].filter((merchantId) => !seen.has(merchantId));
    if (uncovered.length > 0) {
      throw new Error(
        `bad --store-map: no store mapped for merchants with expected mounts: ${uncovered.join(', ')}`
      );
    }
  }
  // Coverage is judged against the committed sample authority, never the
  // operator artifacts alone: a --mounts file and --store-map that agree
  // with each other but omit a sampled merchant would otherwise certify
  // a partial run as ok. Both inputs must cover every required merchant
  // (same complete-matrix philosophy as parseProfiles below).
  if (requiredMerchantIds !== null) {
    const unmapped = requiredMerchantIds.filter(
      (merchantId) => !seen.has(merchantId)
    );
    if (unmapped.length > 0) {
      throw new Error(
        `bad --store-map: required sampled merchants have no mapped store: ${unmapped.join(', ')}`
      );
    }
    if (expectedMounts !== null) {
      const mounted = new Set(expectedMounts.map((mount) => mount.merchantId));
      const unmounted = requiredMerchantIds.filter(
        (merchantId) => !mounted.has(merchantId)
      );
      if (unmounted.length > 0) {
        throw new Error(
          `bad --mounts: no expected mounts for required sampled merchants: ${unmounted.join(', ')}`
        );
      }
    }
  }
  return stores;
}

// Every profile runs both arms. Widths and DPRs follow the spec coverage
// matrix: a responsive source, crop, or layout regression that appears
// only at an edge width must still fail the gate.
function mobileProfile(width, deviceScaleFactor) {
  return {
    deviceScaleFactor,
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width },
  };
}

function desktopProfile(deviceScaleFactor) {
  return {
    deviceScaleFactor,
    hasTouch: false,
    isMobile: false,
    viewport: { height: 800, width: 1365 },
  };
}

export const READINESS_PROFILES = {
  'desktop-1365-dpr1': desktopProfile(1),
  'desktop-1365-dpr2': desktopProfile(2),
  // Fallback exercise, not a second engine: Chromium AVIF support is
  // disabled through CDP on the pilot arm, preserving hydration markup.
  // The browser must select and decode WebP. Control retains AVIF support:
  // originals are
  // format-honest and the comparison baseline is defined in Chrome.
  'mobile-390-dpr2-noavif': { ...mobileProfile(390, 2), disableAvif: true },
  'mobile-360-dpr1': mobileProfile(360, 1),
  'mobile-360-dpr2': mobileProfile(360, 2),
  'mobile-360-dpr3': mobileProfile(360, 3),
  'mobile-390-dpr1': mobileProfile(390, 1),
  'mobile-390-dpr2': mobileProfile(390, 2),
  'mobile-390-dpr3': mobileProfile(390, 3),
  'mobile-412-dpr1': mobileProfile(412, 1),
  'mobile-412-dpr2': mobileProfile(412, 2),
  'mobile-412-dpr3': mobileProfile(412, 3),
};

export const DEFAULT_READINESS_PROFILES = Object.keys(READINESS_PROFILES);

// Expected-mounts file: JSON array in the offline preflight `accepted`
// shape (write it with preflight --write-mounts). The browser gate must
// validate every bound slot per store — not just the primary surface — so
// it consumes the offline verdict rather than re-deriving acceptance.
export function parseMountsJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text));
  } catch {
    throw new Error('bad --mounts: not valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('bad --mounts: expected a non-empty JSON array');
  }
  for (const mount of parsed) {
    if (
      !mount ||
      typeof mount.binding !== 'string' ||
      typeof mount.merchantId !== 'string' ||
      typeof mount.slotId !== 'string' ||
      typeof mount.generationId !== 'string' ||
      typeof mount.stagedOriginal !== 'string'
    ) {
      throw new Error(
        'bad --mounts: every mount needs binding, merchantId, slotId, generationId, and stagedOriginal strings'
      );
    }
  }
  // Preserve the approved byte identities, not just the slot names: the
  // browser gate pins each slot's served URL to its approved generation
  // (pilot) or exact staged original (control), so a stale mounts file
  // can never certify an unreviewed generation.
  return parsed.map((mount) => ({
    binding: mount.binding,
    generationId: mount.generationId,
    merchantId: mount.merchantId,
    slotId: mount.slotId,
    stagedOriginal: mount.stagedOriginal,
  }));
}

// Bounded --mounts read: a corrupted or replaced multi-gigabyte file must
// reject on size instead of buffering whole before parseMountsJson can
// enforce its small expected shape. Same operator-JSON ceiling as the
// offline inventory inputs.
export async function readMountsFile(mountsPath) {
  let read;
  try {
    read = await readUpToBytes(mountsPath, MAX_INVENTORY_BYTES);
  } catch {
    throw new Error(`bad --mounts: cannot read ${mountsPath}`);
  }
  if (read.truncated) {
    throw new Error(
      `bad --mounts: file exceeds the ${MAX_INVENTORY_BYTES}-byte budget`
    );
  }
  return parseMountsJson(read.bytes.toString('utf8'));
}

// Committed sample authority: the merchant ids the readiness gate must
// visit. Statically imported (not an operator path, not import.meta
// resolution — the latter breaks under the test runner's virtual URL
// scheme) so agreeing partial --mounts/--store-map inputs cannot
// define their own coverage.
export function readSampleStoreIds() {
  if (
    !Array.isArray(sampleStores) ||
    sampleStores.length === 0 ||
    sampleStores.some((store) => typeof store?.merchantId !== 'string')
  ) {
    throw new Error('readiness sample authority is malformed');
  }
  return sampleStores.map((store) => store.merchantId);
}

export function parseProfiles(value) {
  if (value === undefined || String(value).trim() === '') {
    return [...DEFAULT_READINESS_PROFILES];
  }
  const names = String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const unknown = names.filter(
    (name) => !Object.hasOwn(READINESS_PROFILES, name)
  );
  if (unknown.length > 0 || names.length === 0) {
    throw new Error(
      `bad --profiles: ${value} (choose from ${DEFAULT_READINESS_PROFILES.join(', ')})`
    );
  }
  const selected = [...new Set(names)];
  if (DEFAULT_READINESS_PROFILES.some((name) => !selected.includes(name))) {
    throw new Error(
      'bad --profiles: the complete readiness matrix is required'
    );
  }
  return selected;
}
