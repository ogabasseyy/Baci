import type {
  CspAllowlist,
  WorkerStorefrontManifest,
} from '../schemas/worker-manifest';

export const PLATFORM_VETTED_CSP_BY_DIRECTIVE = {
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
} as const;

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
    const vettedOrigins = PLATFORM_VETTED_CSP_BY_DIRECTIVE[directive];
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
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    `form-action 'self' https://${manifest.merchantSlug}.usebaci.com https://usebaci.com`,
    'frame-ancestors https://usebaci.com',
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}
