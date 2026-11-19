const BRAND_FAMILY_BY_TOKEN: Readonly<Record<string, string>> = {
  airpods: 'apple',
  apple: 'apple',
  asus: 'asus',
  camon: 'tecno',
  canon: 'canon',
  dell: 'dell',
  elitebook: 'hp',
  envy: 'hp',
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

function extractBrandFamilies(
  texts: Iterable<string | null | undefined>
): string[] {
  const families = new Set<string>();
  for (const rawText of texts) {
    if (!rawText) {
      continue;
    }
    const normalized = rawText
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (!normalized) {
      continue;
    }
    for (const token of normalized.split(/\s+/)) {
      if (Object.hasOwn(BRAND_FAMILY_BY_TOKEN, token)) {
        families.add(BRAND_FAMILY_BY_TOKEN[token]);
      }
    }
  }
  return [...families];
}

export function scoreBlogPostBrandAffinity(
  sourceTexts: Iterable<string | null | undefined>,
  candidateTexts: Iterable<string | null | undefined>
): number {
  const sourceBrands = extractBrandFamilies(sourceTexts);
  const candidateBrands = extractBrandFamilies(candidateTexts);
  if (sourceBrands.length === 0 || candidateBrands.length === 0) {
    return 0;
  }
  const candidateSet = new Set(candidateBrands);
  const sharedCount = sourceBrands.filter((brand) =>
    candidateSet.has(brand)
  ).length;
  return sharedCount > 0 ? 20 : -8;
}
