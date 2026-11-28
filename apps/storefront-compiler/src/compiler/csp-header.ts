import type {
  CspAllowlist,
  WorkerStorefrontManifest,
} from '../schemas/worker-manifest';

const PRIVATE_VETTED_CSP_SETS: Readonly<
  Record<keyof CspAllowlist, ReadonlySet<string>>
> = {
  scriptOrigins: new Set([
    'https://connect.facebook.net',
    'https://www.googletagmanager.com',
    'https://analytics.tiktok.com',
  ]),
  connectOrigins: new Set([
    'https://www.facebook.com',
    'https://www.google-analytics.com',
    'https://analytics.tiktok.com',
  ]),
  imgOrigins: new Set([
    'https://cdn.usebaci.com',
    'https://images.unsplash.com',
    'https://www.facebook.com',
    'https://www.google-analytics.com',
  ]),
};

export const PLATFORM_VETTED_CSP_BY_DIRECTIVE: Readonly<
  Record<keyof CspAllowlist, readonly string[]>
> = Object.freeze({
  scriptOrigins: Object.freeze(
    Array.from(PRIVATE_VETTED_CSP_SETS.scriptOrigins)
  ),
  connectOrigins: Object.freeze(
    Array.from(PRIVATE_VETTED_CSP_SETS.connectOrigins)
  ),
  imgOrigins: Object.freeze(Array.from(PRIVATE_VETTED_CSP_SETS.imgOrigins)),
});

export interface CspGovernanceSummary {
  allowlist: CspAllowlist;
  vettedOrigins: string[];
  unvettedOrigins: string[];
  unvettedByDirective: CspAllowlist;
}

export function summarizeCspGovernance(
  allowlist: CspAllowlist
): CspGovernanceSummary {
  const unvettedSet = new Set<string>();
  const vettedCandidates = new Set<string>();
  const unvettedByDirective: CspAllowlist = {
    scriptOrigins: [],
    connectOrigins: [],
    imgOrigins: [],
  };

  for (const directive of [
    'scriptOrigins',
    'connectOrigins',
    'imgOrigins',
  ] as const) {
    const vettedOrigins = PRIVATE_VETTED_CSP_SETS[directive];
    for (const origin of allowlist[directive]) {
      const canonicalOrigin = new URL(origin).origin.toLowerCase();
      if (vettedOrigins.has(canonicalOrigin)) {
        vettedCandidates.add(origin);
      } else {
        unvettedSet.add(origin);
        if (!unvettedByDirective[directive].includes(origin)) {
          unvettedByDirective[directive].push(origin);
        }
      }
    }
  }

  for (const origin of unvettedSet) {
    vettedCandidates.delete(origin);
  }

  return {
    allowlist,
    vettedOrigins: Array.from(vettedCandidates).sort(),
    unvettedOrigins: Array.from(unvettedSet).sort(),
    unvettedByDirective: {
      scriptOrigins: [...unvettedByDirective.scriptOrigins].sort(),
      connectOrigins: [...unvettedByDirective.connectOrigins].sort(),
      imgOrigins: [...unvettedByDirective.imgOrigins].sort(),
    },
  };
}

export function buildContentSecurityPolicyHeader(
  manifest: WorkerStorefrontManifest
): string {
  const { scriptOrigins, connectOrigins, imgOrigins } = manifest.cspAllowlist;
  const scriptSrc = Array.from(new Set(["'self'", ...scriptOrigins])).join(' ');
  const imgSrc = Array.from(
    new Set(["'self'", 'https://cdn.usebaci.com', 'data:', ...imgOrigins])
  ).join(' ');
  const connectSrc = Array.from(
    new Set(["'self'", 'https://api.usebaci.com', ...connectOrigins])
  ).join(' ');
  const tenantSubdomainOrigin = `https://${manifest.merchantSlug}.usebaci.com`;
  const canonicalHostOrigin = manifest.hostOrigin ?? tenantSubdomainOrigin;
  const frameAncestors = (
    manifest.mode === 'composable'
      ? Array.from(
          new Set([
            'https://usebaci.com',
            ...(manifest.previewOrigin ? [manifest.previewOrigin] : []),
            tenantSubdomainOrigin,
            canonicalHostOrigin,
          ])
        )
      : Array.from(
          new Set([
            'https://usebaci.com',
            ...(manifest.previewOrigin ? [manifest.previewOrigin] : []),
          ])
        )
  ).join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "form-action 'none'",
    `frame-ancestors ${frameAncestors}`,
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}
