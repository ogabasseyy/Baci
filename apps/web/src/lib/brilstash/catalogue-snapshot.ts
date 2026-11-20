import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  type BrilStashProduct,
  brilstashProductSchema,
} from '../../schemas/brilstash-feed';

const DIGEST_FORMAT = 'canonical-json-sha256-v1';
const payloadSchema = z.array(brilstashProductSchema);

type AssortmentPolicy = {
  approvedExternalIds: readonly string[];
  previousExternalIds: readonly string[];
  retiredExternalIds: readonly string[];
  allowEmpty?: boolean;
};

type SnapshotError =
  | 'invalid_payload'
  | 'duplicate_listing'
  | 'unapproved_listing'
  | 'unapproved_removal'
  | 'retired_listing'
  | 'incomplete_assortment'
  | 'empty_assortment';

type PreparedSnapshot =
  | {
      ok: true;
      products: BrilStashProduct[];
      payloadDigest: string;
      digestFormat: typeof DIGEST_FORMAT;
    }
  | { ok: false; code: SnapshotError };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestValidatedPayload(products: BrilStashProduct[]): string {
  return createHash('sha256')
    .update(canonicalJson(products), 'utf8')
    .digest('hex');
}

export function digestBrilStashPayload(payload: unknown): string {
  return digestValidatedPayload(payloadSchema.parse(payload));
}

// Stage the pilot against the exact approved assortment. Missing rows from a
// source read are never implicit removal instructions.
export function prepareBrilStashSnapshot(
  payload: unknown,
  policy: AssortmentPolicy
): PreparedSnapshot {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'invalid_payload' };

  const approved = new Set(policy.approvedExternalIds);
  const retired = new Set(policy.retiredExternalIds);
  const seen = new Set<string>();
  for (const { external_id: externalId } of parsed.data) {
    if (seen.has(externalId)) return { ok: false, code: 'duplicate_listing' };
    if (retired.has(externalId)) return { ok: false, code: 'retired_listing' };
    if (!approved.has(externalId))
      return { ok: false, code: 'unapproved_listing' };
    seen.add(externalId);
  }

  if (
    policy.previousExternalIds.some((id) => !seen.has(id) && !retired.has(id))
  ) {
    return { ok: false, code: 'unapproved_removal' };
  }
  if (seen.size !== approved.size)
    return { ok: false, code: 'incomplete_assortment' };
  if (seen.size === 0 && !policy.allowEmpty)
    return { ok: false, code: 'empty_assortment' };

  const products = parsed.data.sort((left, right) =>
    left.external_id < right.external_id ? -1 : 1
  );
  return {
    ok: true,
    products,
    payloadDigest: digestValidatedPayload(products),
    digestFormat: DIGEST_FORMAT,
  };
}
