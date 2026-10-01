const ACCESSORY_CATEGORY_MARKERS = [
  'accessor',
  'accessories',
  'accessory',
  'case',
  'cases',
  'keyboard',
  'charger',
  'cover',
  'controller',
  'controllers',
  'stand',
  'cable',
  'adapter',
  'mouse',
  'sleeve',
  'bag',
  'dock',
  'hub',
  'band',
  'strap',
  'protector',
  'grip',
  'lens',
  'lenses',
  'battery',
  'batteries',
  'flash',
  'flashes',
  'gift card',
  'gift cards',
  'digital card',
  'digital cards',
  'memory card',
  'memory cards',
  'instant film',
];

function isMarkerBoundary(value: string | undefined): boolean {
  return value === undefined || /[^a-z]/.test(value);
}

function containsMarkerWord(normalized: string, marker: string): boolean {
  for (const form of [marker, `${marker}s`]) {
    let searchFrom = 0;
    for (;;) {
      const matchIndex = normalized.indexOf(form, searchFrom);
      if (matchIndex === -1) {
        break;
      }
      if (
        isMarkerBoundary(normalized[matchIndex - 1]) &&
        isMarkerBoundary(normalized[matchIndex + form.length])
      ) {
        return true;
      }
      searchFrom = matchIndex + 1;
    }
  }
  return false;
}

export function isAccessoryLikeCategory(categoryName: string) {
  const normalized = categoryName
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');

  return ACCESSORY_CATEGORY_MARKERS.some((marker) =>
    containsMarkerWord(normalized, marker)
  );
}
