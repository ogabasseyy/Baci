/**
 * Device Image Mapping for IMEI Checker
 *
 * Maps device model names to Apple CDN image slugs.
 * Used to display device images in IMEI check results.
 */

const APPLE_CDN_BASE =
  'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is';

// Apple CDN slug mappings for iPhone models
// Format: model name substring -> CDN slug
const DEVICE_IMAGE_MAP: Record<string, string> = {
  // iPhone 16 Series (2024)
  'iPhone 16 Pro Max':
    'iphone-16-pro-finish-select-202409-6-9inch-deserttitanium',
  'iPhone 16 Pro': 'iphone-16-pro-finish-select-202409-6-3inch-deserttitanium',
  'iPhone 16 Plus': 'iphone-16-finish-select-202409-6-7inch-ultramarine',
  'iPhone 16': 'iphone-16-finish-select-202409-6-1inch-ultramarine',

  // iPhone 15 Series (2023)
  'iPhone 15 Pro Max':
    'iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium',
  'iPhone 15 Pro': 'iphone-15-pro-finish-select-202309-6-1inch-naturaltitanium',
  'iPhone 15 Plus': 'iphone-15-finish-select-202309-6-7inch-pink',
  'iPhone 15': 'iphone-15-finish-select-202309-pink',

  // iPhone 14 Series (2022)
  'iPhone 14 Pro Max':
    'iphone-14-pro-max-finish-select-202209-6-7inch-deeppurple',
  'iPhone 14 Pro': 'iphone-14-pro-finish-select-202209-6-1inch-deeppurple',
  'iPhone 14 Plus': 'iphone-14-plus-finish-select-202209-6-7inch-blue',
  'iPhone 14': 'iphone-14-finish-select-202209-blue',

  // iPhone 13 Series (2021)
  'iPhone 13 Pro Max': 'iphone-13-pro-max-select-2021',
  'iPhone 13 Pro': 'iphone-13-pro-select-2021',
  'iPhone 13 mini': 'iphone-13-mini-select-2021',
  'iPhone 13': 'iphone-13-select-2021',

  // iPhone 12 Series (2020)
  'iPhone 12 Pro Max': 'iphone-12-pro-max-select-2020',
  'iPhone 12 Pro': 'iphone-12-pro-select-2020',
  'iPhone 12 mini': 'iphone-12-mini-select-2020',
  'iPhone 12': 'iphone-12-select-2020',

  // iPhone 11 Series (2019)
  'iPhone 11 Pro Max': 'iphone-11-pro-max-select-2019',
  'iPhone 11 Pro': 'iphone-11-pro-select-2019',
  'iPhone 11': 'iphone-11-select-2019',

  // iPhone SE
  'iPhone SE (3rd': 'iphone-se-finish-select-202203-midnight',
  'iPhone SE (2nd': 'iphone-se-select-2020',

  // iPhone X Series
  'iPhone XS Max': 'iphone-xs-max-select-2018',
  'iPhone XS': 'iphone-xs-select-2018',
  'iPhone XR': 'iphone-xr-select-2018',
  'iPhone X': 'iphone-x-select-2017',

  // Older models
  'iPhone 8 Plus': 'iphone-8-plus-select-2017',
  'iPhone 8': 'iphone-8-select-2017',
};

/**
 * Get device image URL from model name
 *
 * @param modelName - Device model name from SICKW API (e.g., "iPhone 15 Pro Max 256GB")
 * @returns Apple CDN image URL, or empty string for the caller’s phone icon
 */
export function getDeviceImage(modelName: string): string {
  if (!modelName) return '';

  // Normalize the model name
  const normalized = modelName.trim();

  // Try exact match first
  if (DEVICE_IMAGE_MAP[normalized]) {
    return buildAppleCdnUrl(DEVICE_IMAGE_MAP[normalized]);
  }

  // Try partial match - find the longest matching key
  let bestMatch = '';
  let bestMatchLength = 0;

  for (const key of Object.keys(DEVICE_IMAGE_MAP)) {
    if (normalized.includes(key) && key.length > bestMatchLength) {
      bestMatch = key;
      bestMatchLength = key.length;
    }
  }

  if (bestMatch) {
    return buildAppleCdnUrl(DEVICE_IMAGE_MAP[bestMatch]);
  }

  // Check for generic iPhone match
  if (normalized.toLowerCase().includes('iphone')) {
    // Try to extract model number (e.g., "15", "14", "13")
    const modelMatch = normalized.match(/iPhone\s*(\d+)/i);
    if (modelMatch) {
      const modelNum = modelMatch[1];
      // Find any key containing that model number
      for (const key of Object.keys(DEVICE_IMAGE_MAP)) {
        if (key.includes(`iPhone ${modelNum}`)) {
          return buildAppleCdnUrl(DEVICE_IMAGE_MAP[key]);
        }
      }
    }
  }

  return '';
}

/**
 * Build full Apple CDN URL from slug
 */
function buildAppleCdnUrl(slug: string): string {
  return `${APPLE_CDN_BASE}/${slug}?wid=400&hei=400&fmt=png&qlt=95`;
}
