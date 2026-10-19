import { createHash } from 'node:crypto';

export type PiggyvestStagingSyntheticIdentity = {
  bvn: string;
  name: string;
  email: string;
  phone: string;
};

/**
 * Deterministic per-customer synthetic identity for staging provisioning.
 *
 * Every staging provisioning call must use operator-owned synthetic PII
 * (never real BVNs or copied customer records), but a single fixed fixture
 * breaks multi-customer staging: once the first customer owns the fixture,
 * every later customer's create call returns `new_customer: false` and is
 * rejected as `existing_customer_unowned`. Deriving one fixture per
 * allowlisted customer keeps provisioning working for the whole allowlist
 * while staying inside obviously-synthetic ranges (000-prefixed BVN,
 * example.test email, +234000-prefixed phone) that can never collide with
 * real customer PII. Deterministic so retries re-resolve the same fixture.
 */
export function resolvePiggyvestStagingSyntheticIdentity(
  customerId: string
): PiggyvestStagingSyntheticIdentity {
  const digest = createHash('sha256')
    .update(`piggyvest-staging-synthetic/v1:${customerId}`)
    .digest('hex');
  const digits = (offset: number, length: number) =>
    Array.from(
      { length },
      (_, index) =>
        Number.parseInt(
          digest.slice(offset + index * 2, offset + index * 2 + 2),
          16
        ) % 10
    ).join('');
  return {
    bvn: `000${digits(0, 8)}`,
    name: 'Synthetic Customer',
    email: `synthetic+${digest.slice(32, 44)}@example.test`,
    phone: `+234000${digits(16, 7)}`,
  };
}
