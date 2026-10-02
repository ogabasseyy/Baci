import { canonicalizeCommerceVariantAxis, toAsciiLowerCase } from '@baci/shared/lib';

const keys: Record<string, string> = {
  storage: 'storage_gb', storage_gb: 'storage_gb', capacity: 'storage_gb', storage_capacity: 'storage_gb',
  ram: 'ram_gb', memory: 'ram_gb', ram_gb: 'ram_gb', ram_options: 'ram_gb',
  color: 'color', colour: 'color', connector: 'connector',
  power: 'power_w', wattage: 'power_w', power_w: 'power_w',
  processor: 'processor', connectivity: 'connectivity',
  screen_inches: 'screen_inches', refresh_hz: 'refresh_hz',
};

/** Normalize known catalog attribute keys/units, not natural language shopper sentences. */
export function normalizeDiscoveryOptionAttributes(attributes: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(attributes)) {
    // Storefront axes arrive in any spelling (storageCapacity, screen.inches,
    // RAM-Options), so canonicalize with the shared helper before the local
    // discovery allowlist; unrecognized axes still fall through to no key.
    const normalizedKey = canonicalizeCommerceVariantAxis(rawKey) ?? '';
    const key = Object.hasOwn(keys, normalizedKey) ? keys[normalizedKey] : undefined;
    if (!key) continue;
    const numeric = ['storage_gb', 'ram_gb', 'power_w', 'screen_inches', 'refresh_hz'].includes(key);
    if (!numeric) {
      // NFC, matching the matcher: NFKC would fold compatibility characters
      // (full-width, ligatures, circled digits) that the intent side preserves,
      // incorrectly rejecting identical values.
      result[key] = typeof rawValue === 'string' ? toAsciiLowerCase(rawValue.normalize('NFC').trim()) : null;
      continue;
    }
    // A malformed overriding variant attribute must not inherit the base value.
    result[key] = null;
    if (typeof rawValue === 'number') {
      if (Number.isFinite(rawValue) && rawValue >= 0) result[key] = rawValue;
      continue;
    }
    if (typeof rawValue !== 'string') continue;
    const match = /^\s*(?:ram\s*)?(\d+(?:\.\d+)?)\s*(gb|tb|mb|w|hz|inches?|in)?(?:\s+(ram|memory|ssd|hdd|nvme|emmc))?\s*$/i.exec(rawValue);
    if (!match) continue;
    if (/^\s*ram\b/i.test(rawValue) && key !== 'ram_gb') continue;
    const value = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    const label = match[3]?.toLowerCase();
    if (label && !((key === 'ram_gb' && ['ram', 'memory'].includes(label)) ||
      (key === 'storage_gb' && ['ssd', 'hdd', 'nvme', 'emmc'].includes(label)))) continue;
    if (key.endsWith('_gb')) {
      if (unit && !['gb', 'tb', 'mb'].includes(unit)) continue;
      result[key] = value * (unit === 'tb' ? 1024 : unit === 'mb' ? 1 / 1024 : 1);
    } else if (!unit || (key === 'power_w' && unit === 'w') ||
      (key === 'refresh_hz' && unit === 'hz') || (key === 'screen_inches' && ['in', 'inch', 'inches'].includes(unit))) {
      result[key] = value;
    }
  }
  return result;
}
