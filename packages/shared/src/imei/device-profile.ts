export interface ImeiDeviceProfile {
  version: 1;
  brand: string | null;
  model: string | null;
  color: string | null;
  storage: string | null;
  catalogProductId?: string;
  imageMatch: 'color' | 'model' | 'none';
}

const COLORS = [
  'Phantom Black',
  'Natural Titanium',
  'Black Titanium',
  'White Titanium',
  'Blue Titanium',
  'Desert Titanium',
  'Titanium Gray',
  'Titanium Grey',
  'Titanium Black',
  'Cosmic Orange',
  'Deep Blue',
  'Space Black',
  'Space Gray',
  'Space Grey',
  'Mystic Bronze',
  'Midnight Green',
  'Midnight',
  'Starlight',
  'Ultramarine',
  'Graphite',
  'Silver',
  'Black',
  'White',
  'Blue',
  'Green',
  'Gold',
  'Purple',
  'Pink',
  'Yellow',
  'Red',
  'Gray',
  'Grey',
  'Orange',
  'Teal',
];
const BRANDS: readonly [RegExp, string][] = [
  [/^(?:apple\b|iphone\b|ipad\b|macbook\b|imac\b)/i, 'Apple'],
  [/^(?:samsung\b|galaxy\b)/i, 'Samsung'],
  [/^(?:google\s+)?pixel\b/i, 'Google'],
  [/^(?:xiaomi\b|redmi\b|poco\b)/i, 'Xiaomi'],
  [/^oneplus\b/i, 'OnePlus'],
  [/^oppo\b/i, 'OPPO'],
  [/^realme\b/i, 'Realme'],
  [/^tecno\b/i, 'Tecno'],
  [/^infinix\b/i, 'Infinix'],
  [/^itel\b/i, 'Itel'],
  [/^honor\b/i, 'Honor'],
  [/^huawei\b/i, 'Huawei'],
  [/^(?:motorola|moto)\b/i, 'Motorola'],
  [/^sonim\b/i, 'Sonim'],
  [/^nokia\b/i, 'Nokia'],
  [/^lg\b/i, 'LG'],
  [/^sony\b/i, 'Sony'],
  [/^htc\b/i, 'HTC'],
  [/^nothing\b/i, 'Nothing'],
  [/^lenovo\b/i, 'Lenovo'],
  [/^dell\b/i, 'Dell'],
  [/^hp\b/i, 'HP'],
  [/^asus\b/i, 'ASUS'],
  [/^zte\b/i, 'ZTE'],
];

function clean(value?: string): string | null {
  const text = value?.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return text &&
    text.length <= 160 &&
    !/\b\d{14,16}\b/.test(text) &&
    !/^(?:unknown(?: device)?|n\/a|not available|null|none|undefined)$/i.test(
      text
    )
    ? text
    : null;
}

export function imeiColorKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/grey/g, 'gray')
    .replace(/[^a-z0-9]/g, '');
}

export function imeiModelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Provider observations only. Catalog matches must not invent device attributes. */
export function getImeiDeviceProfile(input: {
  device: string;
  color?: string;
  storage?: string;
  brand?: string;
}): ImeiDeviceProfile {
  const device = clean(input.device);
  let color = clean(input.color);
  if (!color && device)
    color =
      COLORS.find((value) =>
        device.toLowerCase().endsWith(` ${value.toLowerCase()}`)
      ) ?? null;
  if (color)
    color =
      COLORS.find(
        (value) => imeiColorKey(value) === imeiColorKey(color ?? '')
      ) ?? color;
  const capacities = device?.match(/\b\d{1,4}\s*(?:GB|TB)\b/gi) ?? [];
  const storageText =
    clean(input.storage) ?? (capacities.length === 1 ? capacities[0] : null);
  const storage =
    storageText
      ?.match(/^\d{1,4}\s*(?:GB|TB)$/i)?.[0]
      .replace(/\s/g, '')
      .toUpperCase() ?? null;
  const reportedBrand = clean(input.brand);
  const brand =
    (device ? BRANDS.find(([pattern]) => pattern.test(device))?.[1] : null) ??
    (reportedBrand
      ? BRANDS.find(([pattern]) => pattern.test(reportedBrand))?.[1]
      : null) ??
    null;
  let model = brand ? device : null;
  if (model) {
    if (color) {
      const words = model.split(' ');
      const colorWords = color.split(' ').length;
      if (
        imeiColorKey(words.slice(-colorWords).join(' ')) === imeiColorKey(color)
      )
        model = words.slice(0, -colorWords).join(' ');
    }
    model = model
      .replace(/\b\d{1,4}\s*(?:GB|TB)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (brand && model.toLowerCase().startsWith(`${brand.toLowerCase()} `))
      model = model.slice(brand.length).trim();
    // Manufacturer labels often append configuration and region; retain the exact Apple family.
    const iphone = model.match(
      /^iphone\s+(\d{1,2})(\s+pro(?:\s+max)?|\s+plus|\s+mini)?\b/i
    );
    if (iphone) {
      const suffix = (iphone[2] ?? '')
        .replace(/pro/gi, 'Pro')
        .replace(/max/gi, 'Max')
        .replace(/plus/gi, 'Plus')
        .replace(/mini/gi, 'mini');
      model = `iPhone ${iphone[1]}${suffix}`;
    }
    // A manufacturer hint does not turn a serial-like opaque token into a model.
    if (
      model.toLowerCase() === brand?.toLowerCase() ||
      (/^[a-z0-9]{10,32}$/i.test(model) &&
        !BRANDS.some(([pattern]) => pattern.test(model ?? '')))
    )
      model = null;
  }
  return {
    version: 1,
    brand,
    model: model || null,
    color,
    storage,
    imageMatch: 'none',
  };
}
