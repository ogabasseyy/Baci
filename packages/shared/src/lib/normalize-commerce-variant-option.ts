import { canonicalizeCommerceVariantAxis } from './canonicalize-commerce-variant-axis';

function normalizeGraphicsOption(value: string) {
  const modelMatch = value.match(
    /\b((?:RTX|GTX)\s*\d{3,4}(?:\s*(?:Ti|Super))?)\b/i
  );
  const memoryMatch = value.match(/\b(\d+)\s*GB\b/i);
  if (!(modelMatch && memoryMatch && modelMatch[1] && memoryMatch[1])) {
    return value;
  }

  const normalizedModel = modelMatch[1]
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(/TI\b/, 'Ti')
    .replace(/SUPER\b/, 'Super');
  const normalizedMemory = `${memoryMatch[1]}GB`;

  // Keep SKU-defining leftovers (Laptop, wattage, …) so distinct graphics
  // configs do not collapse after model/VRAM canonicalization.
  const remainder = value
    .replace(modelMatch[0], ' ')
    .replace(memoryMatch[0], ' ')
    .replace(/\b(?:NVIDIA|GeForce|Graphics|GPU)\b/gi, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  const base = `NVIDIA GeForce ${normalizedModel} ${normalizedMemory}`;
  return remainder ? `${base} ${remainder}` : base;
}

function normalizeCapacityToken(value: string) {
  return value.replace(
    /^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)\b/i,
    (_match, amount: string, unit: string) => `${amount}${unit.toUpperCase()}`
  );
}

export function normalizeCommerceVariantOption(axis: string, value: unknown) {
  const canonicalAxis = canonicalizeCommerceVariantAxis(axis);
  if (!canonicalAxis || typeof value !== 'string') {
    return '';
  }

  let normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return '';
  }

  if (canonicalAxis === 'graphics') {
    normalized = normalizeGraphicsOption(normalized);
  } else if (canonicalAxis === 'processor') {
    normalized = normalized.replace(/\bIntel\s+Ultra\b/i, 'Intel Core Ultra');
  } else if (canonicalAxis === 'ram') {
    normalized = normalizeCapacityToken(normalized.replace(/\s+RAM$/i, ''));
  } else if (canonicalAxis === 'storage' || canonicalAxis === 'capacity') {
    // Preserve SSD/HDD (and similar medium tokens) so distinct SKUs like
    // "1TB SSD" vs "1TB HDD" do not collapse into a single option.
    normalized = normalized.replace(
      /^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)(?:\s+(SSD|HDD|NVMe|eMMC))?$/i,
      (_match, amount: string, unit: string, medium: string | undefined) =>
        medium
          ? `${amount}${unit.toUpperCase()} ${medium.toUpperCase()}`
          : `${amount}${unit.toUpperCase()}`
    );
  }

  return normalized;
}
