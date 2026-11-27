import type {
  CspAllowlist,
  WorkerStorefrontManifest,
} from '../schemas/worker-manifest';

export const PLATFORM_VETTED_CSP_BY_DIRECTIVE = {
  scriptOrigins: new Set([
    'connect.facebook.net',
    'www.googletagmanager.com',
    'analytics.tiktok.com',
  ]),
  connectOrigins: new Set([
    'www.facebook.com',
    'www.google-analytics.com',
    'analytics.tiktok.com',
  ]),
  imgOrigins: new Set([
    'cdn.usebaci.com',
    'images.unsplash.com',
    'www.facebook.com',
    'www.google-analytics.com',
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
    const vettedHosts = PLATFORM_VETTED_CSP_BY_DIRECTIVE[directive];
    for (const origin of allowlist[directive]) {
      const hostname = new URL(origin).hostname.toLowerCase();
      if (vettedHosts.has(hostname)) {
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
  const scriptSrc = ["'self'", ...scriptOrigins].join(' ');
  const imgSrc = [
    "'self'",
    'https://*.supabase.co',
    'https://cdn.usebaci.com',
    'data:',
    ...imgOrigins,
  ].join(' ');
  const connectSrc = [
    "'self'",
    'https://api.usebaci.com',
    ...connectOrigins,
  ].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "form-action 'self' https://*.usebaci.com",
    'frame-ancestors https://usebaci.com',
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}
