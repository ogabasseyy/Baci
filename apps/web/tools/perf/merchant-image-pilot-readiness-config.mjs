// Readiness gate input config: CLI parsing plus the required browser
// profile matrix. The gate must qualify every profile that selects
// different image tiers or lays out differently — mobile DPR 1/2/3 and
// desktop — never a single hardcoded viewport.
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const match = /^--([a-z-]+)=(.*)$/.exec(argv[i]);
    if (match) {
      args[match[1]] = match[2];
    }
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
