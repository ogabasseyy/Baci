import { isPrivateLanHost, requestHost } from './merchant-host';

function isBodyProofPlatformHost(
  host: string,
  rootDomain: string,
  environment: string | undefined
): boolean {
  // Loopback and private-LAN hosts are development surfaces only: in
  // production they must never receive the script-readable body proof,
  // matching the loopback handling for handoff redemption.
  const isLocalHost =
    host === 'localhost' || host === '127.0.0.1' || isPrivateLanHost(host);
  return (
    // Only the programmatic api.* surfaces (plus non-production dev
    // loopback/LAN) receive the script-readable body proof. The
    // browsable root and www hosts serve web pages, so they stay on
    // the httpOnly-cookie path like merchant subdomains: a bootstrap
    // proof is a replayable Bearer [REDACTED] that upgrades into a
    // full session proof.
    host === `api.${rootDomain}` ||
    host === `api-staging.${rootDomain}` ||
    (environment !== 'production' && isLocalHost)
  );
}

/**
 * True when a bootstrap proof may leave in the response body rather
 * than only in the httpOnly cookie. Merchant resolution may accept a
 * merchant hint on more hosts, but arbitrary deployment hosts are not
 * a credential-disclosure surface: body proofs are limited to the
 * production/staging API hosts and local native/programmatic hosts
 * (loopback and private LAN). The browsable root and www hosts are
 * deliberately excluded and stay on the httpOnly-cookie path.
 */
export function requestUsesSharedPlatformHost(
  request: Request,
  rootDomain?: string,
  environment: string | undefined = process.env.NODE_ENV
): boolean {
  const resolvedRoot = (
    rootDomain ??
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
    'usebaci.com'
  ).toLowerCase();
  return isBodyProofPlatformHost(
    requestHost(request),
    resolvedRoot,
    environment
  );
}
