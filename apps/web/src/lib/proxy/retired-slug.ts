import { getCustomDomainForSlug } from '@/lib/domain-cache-simple';
import { ROOT_DOMAIN } from '@/lib/proxy/host';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';

export async function resolveRetiredSlugRedirect(
  oldSlug: string,
  restPath: string,
  search: string,
  method: string
): Promise<string | null> {
  if (method !== 'GET' && method !== 'HEAD') {
    return null;
  }
  const currentSlug = await getCurrentSlugForAlias(oldSlug);
  if (!currentSlug || currentSlug === oldSlug) {
    return null;
  }
  const renamedCustomDomain = await getCustomDomainForSlug(currentSlug);
  const destinationHost =
    renamedCustomDomain ?? `${currentSlug}.${ROOT_DOMAIN}`;
  return `https://${destinationHost}${restPath}${search}`;
}
