import { createHash } from 'node:crypto';

export type JumiaPreflightDigestInput = {
  merchantId: string;
  integrationId: string;
  shopId: string;
  businessClientCode: string;
  countryCode: string;
  localCurrency: string;
  selectionId: string;
  sourceCategoryId: string;
  sourcePage: { page: number; limit: number };
  products: readonly {
    productId: string;
    sourceVersion: string;
    mapping: unknown;
    evidence: unknown;
    prepared?: unknown;
  }[];
};

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => (item === undefined ? 'null' : stableJson(item))).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError('Preflight digest accepts only plain data.');
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new TypeError('Preflight digest accepts only JSON-compatible data.');
}

/** Server-only SHA-256 fingerprint; this is scoped evidence, not authorization. */
export function computeJumiaProductPreflightDigest(
  input: JumiaPreflightDigestInput
): string {
  const products = [...input.products]
    .sort((left, right) => left.productId.localeCompare(right.productId))
    .map((product) => ({ ...product }));
  const serialized = stableJson({ ...input, products });
  return `jumia-preflight-v1:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
}
