// Readiness gate input config: CLI parsing plus the required browser
// profile matrix. The gate must qualify every profile that selects
// different image tiers or lays out differently — mobile DPR 1/2/3 and
// desktop — never a single hardcoded viewport.
//
// Every CLI token must be a known --key=value: a typoed flag (or a stray
// value from a space-separated `--flag value`) is rejected instead of
// silently dropped, so a green report always proves the matrix the caller
// meant to configure.
export const READINESS_CLI_OPTIONS = [
  'chrome',
  'hero-stores',
  'mounts',
  'origin',
  'profiles',
  'store-map',
];

export const SETTINGS_CLI_OPTIONS = [
  'browser-version',
  'cache-provenance',
  'expect-cpu-slowdown',
  'expect-chrome-major',
  'expect-connectivity',
  'expect-dpr',
  'expect-form-factor',
  'expect-iterations',
  'expect-lh-dpr',
  'expect-lh-viewport',
  'expect-throttling-method',
  'expect-viewport',
  'har',
  'lighthouse',
  'screenshot',
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
    args[match[1]] = match[2];
  }
  return args;
}

export function parseStoreMap(value) {
  return String(value ?? '')
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
}

// Every profile runs both arms. Mobile DPR 1/3 select different tiers
// than DPR 2; desktop lays out differently and must not overflow.
export const READINESS_PROFILES = {
  'desktop-dpr1': {
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    viewport: { height: 800, width: 1280 },
  },
  'desktop-dpr2': {
    deviceScaleFactor: 2,
    hasTouch: false,
    isMobile: false,
    viewport: { height: 800, width: 1280 },
  },
  'mobile-dpr1': {
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 },
  },
  'mobile-dpr2': {
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 },
  },
  'mobile-dpr3': {
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 },
  },
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
  return [...new Set(names)];
}
