import { z } from 'zod';
import { experiencePreviewInput } from './experience-preview';

export const experienceOwnerSubject = z.uuid();

const envelope = {
  version: z.literal(1),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().safe(),
  accessToken: z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[A-Za-z0-9_.-]+$/),
};

export const experienceOwnerWireSchemas = {
  'owner-preview/v1': z.strictObject({
    ...envelope,
    input: experiencePreviewInput,
  }),
  'verifier-attest/v1': z.strictObject({
    ...envelope,
    approvalId: z.uuid(),
    kind: z.enum(['draft', 'lifecycle']),
  }),
  'verifier-public/v1': z.strictObject({
    ...envelope,
    approvalId: z.uuid(),
  }),
};

export type ExperienceOwnerWireDomain = keyof typeof experienceOwnerWireSchemas;

function canonicalizeOwnerWireValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeOwnerWireValue);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) sorted[key] = canonicalizeOwnerWireValue(entry);
    }
    return sorted;
  }
  return value;
}

/** Deterministic sorted-key JSON serialization for already-validated wire values. */
export function serializeCanonicalOwnerWirePayload(value: unknown): string {
  return JSON.stringify(canonicalizeOwnerWireValue(value));
}

/** Validate and serialize an owner/verifier wire envelope with deterministic key order. */
export function serializeExperienceOwnerWireMessage(
  domain: ExperienceOwnerWireDomain,
  value: unknown
): string {
  return serializeCanonicalOwnerWirePayload(
    experienceOwnerWireSchemas[domain].parse(value)
  );
}
