import {
  getImeiDeviceProfile,
  type ImeiDeviceProfile,
  imeiColorKey,
  imeiModelKey,
} from '@baci/shared/imei';
import { getPrimaryProductImage } from '@/lib/product-image';

type Images = Array<string | { url?: string | null }>;
export interface ImeiCatalogProduct {
  id: string;
  name: string;
  brand: string | null;
  images: Images;
  variants: { attributes: Record<string, unknown>; images: Images }[];
}

/** Catalog titles must contain only the device and its observed configuration.
 * Provider descriptions may be verbose; catalog accessories must not inherit an
 * iPhone family merely because their title starts with that family's name.
 */
function catalogModelKey(
  product: ImeiCatalogProduct,
  profile: ImeiDeviceProfile
) {
  let name = product.name
    .normalize('NFKC')
    .replace(/\b\d{1,4}\s*(?:GB|TB)\b/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (
    profile.brand &&
    name.toLowerCase().startsWith(`${profile.brand.toLowerCase()} `)
  )
    name = name.slice(profile.brand.length).trim();
  if (profile.color) {
    const words = name.split(' ');
    const count = profile.color.split(' ').length;
    if (
      imeiColorKey(words.slice(-count).join(' ')) ===
      imeiColorKey(profile.color)
    )
      name = words.slice(0, -count).join(' ');
  }
  return imeiModelKey(name);
}

export function isImeiCatalogModelMatch(
  profile: ImeiDeviceProfile,
  product: ImeiCatalogProduct
): boolean {
  if (!profile.model || !profile.brand) return false;
  const candidate = getImeiDeviceProfile({
    device: product.name,
    brand: product.brand ?? undefined,
  });
  return (
    candidate.brand?.toLowerCase() === profile.brand.toLowerCase() &&
    !!candidate.model &&
    imeiModelKey(candidate.model) === imeiModelKey(profile.model) &&
    catalogModelKey(product, candidate) === imeiModelKey(profile.model)
  );
}

export function matchImeiCatalogImage(
  profile: ImeiDeviceProfile,
  products: readonly ImeiCatalogProduct[]
) {
  if (!profile.model || !profile.brand) return null;
  for (const product of products) {
    if (!isImeiCatalogModelMatch(profile, product)) continue;
    if (profile.color) {
      const variants = product.variants.filter(
        (variant) =>
          typeof variant.attributes.color === 'string' &&
          imeiColorKey(variant.attributes.color) ===
            imeiColorKey(profile.color ?? '')
      );
      variants.sort(
        (a, b) =>
          Number(b.attributes.storage === profile.storage) -
          Number(a.attributes.storage === profile.storage)
      );
      for (const variant of variants) {
        const imageUrl = getPrimaryProductImage(variant.images);
        if (imageUrl)
          return { imageUrl, productId: product.id, match: 'color' as const };
      }
      // A named colour must never silently receive the first (possibly wrong) colour.
      continue;
    }
    const imageUrl = getPrimaryProductImage(product.images);
    if (imageUrl)
      return { imageUrl, productId: product.id, match: 'model' as const };
  }
  return null;
}
