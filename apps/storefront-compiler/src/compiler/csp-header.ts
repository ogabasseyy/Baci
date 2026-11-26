import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';

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
