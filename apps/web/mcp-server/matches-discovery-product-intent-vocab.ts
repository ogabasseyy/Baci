/** Shared vocabulary for discovery product-intent matching: product types,
 * brands, device families, and word-level matching tables. */
export const genericTypes = new Set([
  'device', 'devices', 'gadget', 'gadgets', 'item', 'items',
  'product', 'products', 'thing', 'things',
]);
export const detailBoundary = new Set(['under', 'below', 'between', 'with', 'for', 'at', 'in', 'priced', 'costing', 'compatible', 'fits']);
export const modelAnchorStopwords = new Set(['a', 'an', 'the', 'model', 'version', 'size', 'of', 'for', 'with']);
export const genericPhoneModifiers = new Set([
  'android', 'budget', 'cheap', 'fast', 'good', 'latest', 'mobile', 'new',
  'refurbished', 'smart', 'unlocked', 'used',
]);
export const genericItemModifiers = new Set([
  ...genericPhoneModifiers, 'and', 'or', 'affordable', 'anything', 'compact', 'gaming', 'home', 'office', 'portable',
  'power', 'security', 'something', 'that',
]);
export const phoneAccessoryTypes = new Set([
  'cable', 'cables', 'case', 'cases', 'charger', 'chargers', 'cover', 'covers', 'earbud', 'earbuds',
  'holder', 'holders', 'lens', 'lenses', 'mount', 'mounts', 'pouch', 'pouches', 'protector', 'protectors',
  'stand', 'stands', 'tripod', 'tripods', 'wallet', 'wallets',
]);
export const productTypes = new Set([
  ...phoneAccessoryTypes, 'accessory', 'accessories', 'adapter', 'adapters', 'bank', 'banks',
  'bag', 'bags', 'camera', 'cameras', 'diffuser', 'diffusers', 'dock', 'docks', 'earbud', 'earbuds', 'earphone', 'earphones',
  'headphone', 'headphones', 'keyboard', 'keyboards', 'laptop', 'laptops', 'macbook', 'macbooks',
  'hub', 'hubs', 'monitor', 'monitors', 'mouse', 'mice', 'phone', 'phones', 'printer', 'printers', 'sleeve', 'sleeves', 'speaker', 'speakers',
  'smartphone', 'smartphones', 'stylus', 'styluses', 'tablet', 'tablets', 'television', 'televisions',
  'tv', 'tvs', 'watch', 'watches',
]);
export const accessoryHeadTypes = new Set([
  'bag', 'bags', 'case', 'cases', 'cover', 'covers', 'dock', 'docks', 'holder', 'holders', 'hub', 'hubs', 'mount', 'mounts', 'pouch', 'pouches', 'sleeve', 'sleeves',
  'protector', 'protectors', 'stand', 'stands', 'tripod', 'tripods', 'wallet', 'wallets',
]);
export const knownBrandWords = new Set([
  'apple', 'asus', 'dell', 'google', 'hp', 'huawei', 'infinix', 'itel', 'jbl',
  'lenovo', 'lg', 'msi', 'nokia', 'oppo', 'pixel', 'realme', 'redmi', 'riversong',
  'samsung', 'sony', 'tecno', 'vivo', 'xiaomi',
]);
export const knownDeviceFamilyWords = new Set([
  'airpod', 'airpods', 'galaxy', 'ipad', 'iphone', 'iphones', 'macbook', 'macbooks', 'pixel', 'pixels',
]);
export const deviceQualifierAliases = new Map<string, string[]>([
  ['phone', ['phone', 'smartphone', 'iphone']],
  ['phones', ['phone', 'smartphone', 'iphone']],
  ['smartphone', ['phone', 'smartphone', 'iphone']],
  ['smartphones', ['phone', 'smartphone', 'iphone']],
  ['laptop', ['laptop', 'macbook', 'notebook']],
  ['laptops', ['laptop', 'macbook', 'notebook']],
  ['camera', ['camera']],
  ['cameras', ['camera']],
  ['tablet', ['tablet', 'ipad']],
  ['tablets', ['tablet', 'ipad']],
]);
export const modelQualifiers = new Set(['max', 'mini', 'plus', 'pro', 'ultra']);

export const irregularPlurals = new Map([
  ['lenses', 'lens'], ['mice', 'mouse'], ['pouches', 'pouch'], ['styluses', 'stylus'], ['watches', 'watch']]);
export const irregularSingulars = new Map([
  ['lens', 'lenses'], ['mouse', 'mice'], ['pouch', 'pouches'], ['stylus', 'styluses'], ['watch', 'watches']]);
export const equivalentTerms = new Map([
  ['mouse', ['mice']], ['mice', ['mouse']], ['tv', ['television', 'televisions']], ['tvs', ['television', 'televisions']],
  ['television', ['tv', 'tvs']], ['televisions', ['tv', 'tvs']]]);
export const specUnitWords = new Set(['gb', 'tb', 'mb', 'mah', 'w', 'hz', 'mp']);
export const displayItemTypes = new Set([
  'camera', 'cameras', 'laptop', 'laptops', 'macbook', 'macbooks', 'monitor', 'monitors',
  'phone', 'phones', 'smartphone', 'smartphones', 'tablet', 'tablets', 'television', 'televisions', 'tv', 'tvs',
]);
