/**
 * The dashboard merchant context reports the store's primary active domain.
 * For most stores that is the generated Baci subdomain row, not a custom
 * domain, so it must be excluded before the UI says a custom domain is active.
 * Returns the trimmed custom domain, or null when there is none.
 */
export function getActiveCustomDomain(
  primaryDomain: string | null | undefined,
  rootDomain: string
): string | null {
  const domain = primaryDomain?.trim();
  if (!domain) return null;

  const host = domain.toLowerCase();
  const root = rootDomain.trim().toLowerCase();
  if (host === root || host.endsWith(`.${root}`)) return null;

  return domain;
}
