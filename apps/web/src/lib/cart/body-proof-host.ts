import { isPrivateLanHost, requestHost } from './merchant-resolution';

function isBodyProofPlatformHost(host: string, rootDomain: string): boolean {
  return (
    host === rootDomain ||
    host === `www.${rootDomain}` ||
    host === `api.${rootDomain}` ||
    host === `api-staging.${rootDomain}` ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    // Native dev builds call private-LAN origins and require the
    // body proof, mirroring merchant resolution's hint-governed hosts.
    isPrivateLanHost(host)
  );
}

/**
 * True when a bootstrap proof may leave in the response body rather
 * than only in the httpOnly cookie. Merchant resolution may accept a
 * merchant hint on more hosts, but arbitrary deployment hosts are not
 * a credential-disclosure surface: body proofs are limited to the
 * production/staging API, root, and local native/programmatic hosts.
 */
export function requestUsesSharedPlatformHost(
  request: Request,
  rootDomain?: string
): boolean {
  const resolvedRoot = (
    rootDomain ??
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
    'usebaci.com'
  ).toLowerCase();
  return isBodyProofPlatformHost(requestHost(request), resolvedRoot);
}
