export function extractPlatformSubdomainSlug(
  normalizedIdentifier: string
): string | null {
  const rootDomain = (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim() || 'usebaci.com'
  )
    .replace(/:\d+$/, '')
    .toLowerCase();

  for (const suffix of [`.${rootDomain}`, '.localhost']) {
    if (normalizedIdentifier.endsWith(suffix)) {
      const subdomain = normalizedIdentifier.slice(0, -suffix.length);
      if (subdomain && !subdomain.includes('.')) {
        return subdomain;
      }
    }
  }

  return null;
}
