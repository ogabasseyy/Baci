export const BOILERPLATE_BLOG_METADATA_PHRASES = new Set([
  'accessories',
  'audio',
  'buyer guide',
  'buying guide',
  'gaming',
  'laptop',
  'laptops',
  'monitors',
  'nigeria',
  'nigeria buyer guide',
  'phone',
  'phones',
  'price in nigeria',
  'printers',
  'smart tvs',
  'smartphone',
  'smartphones',
  'tablet',
  'tablets',
  'wearables',
]);

const BRAND_FAMILY_BY_TOKEN: Readonly<Record<string, string>> = {
  airpods: 'apple',
  apple: 'apple',
  asus: 'asus',
  camon: 'tecno',
  canon: 'canon',
  dell: 'dell',
  elitebook: 'hp',
  galaxy: 'samsung',
  google: 'google',
  honor: 'honor',
  hp: 'hp',
  ideapad: 'lenovo',
  infinix: 'infinix',
  inspiron: 'dell',
  ipad: 'apple',
  iphone: 'apple',
  itel: 'itel',
  jbl: 'jbl',
  latitude: 'dell',
  legion: 'lenovo',
  lenovo: 'lenovo',
  lg: 'lg',
  macbook: 'apple',
  nokia: 'nokia',
  omen: 'hp',
  oppo: 'oppo',
  pavilion: 'hp',
  phantom: 'tecno',
  pixel: 'google',
  playstation: 'sony',
  poco: 'xiaomi',
  pova: 'tecno',
  ps5: 'sony',
  redmi: 'xiaomi',
  reno: 'oppo',
  rog: 'asus',
  samsung: 'samsung',
  sony: 'sony',
  spark: 'tecno',
  spectre: 'hp',
  starlink: 'starlink',
  tecno: 'tecno',
  thinkpad: 'lenovo',
  tuf: 'asus',
  vivo: 'vivo',
  vivobook: 'asus',
  xiaomi: 'xiaomi',
  xps: 'dell',
  zenbook: 'asus',
};

export function extractBlogPostBrandFamilies(
  tokens: Iterable<string>
): string[] {
  const families = new Set<string>();
  for (const token of tokens) {
    if (Object.hasOwn(BRAND_FAMILY_BY_TOKEN, token)) {
      families.add(BRAND_FAMILY_BY_TOKEN[token]);
    }
  }
  return [...families];
}

export function scoreBlogPostBrandAffinity(
  sourceTokens: Iterable<string>,
  candidateTokens: Iterable<string>
): number {
  const sourceBrands = extractBlogPostBrandFamilies(sourceTokens);
  const candidateBrands = extractBlogPostBrandFamilies(candidateTokens);
  if (sourceBrands.length === 0 || candidateBrands.length === 0) {
    return 0;
  }
  const candidateSet = new Set(candidateBrands);
  const sharedCount = sourceBrands.filter((brand) =>
    candidateSet.has(brand)
  ).length;
  return sharedCount > 0 ? 20 : -8;
}
