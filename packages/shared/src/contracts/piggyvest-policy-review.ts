import { z } from 'zod';
import { piggyvestPolicyTextByteLength } from './piggyvest-policy-text-byte-length';

const text = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine(
      (value) =>
        value.trim().length > 0 &&
        Number.isFinite(piggyvestPolicyTextByteLength(value))
    );
const version = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);

export const piggyvestPolicyReviewSchemas = {
  view: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('draft'),
      goalId: z.uuid(),
      revisionId: z.uuid(),
      durationMonths: z.number().int().min(1).max(6).optional(),
      device: z.strictObject({
        productName: text(200),
        variant: text(200).nullable(),
        condition: text(100),
      }),
      terms: z.strictObject({
        version,
        hash,
        text: text(32768).refine(
          (value) => piggyvestPolicyTextByteLength(value) <= 32768
        ),
      }),
      consent: z.enum(['required', 'accepted']),
    }),
    z.strictObject({ status: z.literal('unavailable') }),
  ]),
  acceptance: z.strictObject({
    goalId: z.uuid(),
    revisionId: z.uuid(),
    durationMonths: z.number().int().min(1).max(6).optional(),
    termsHash: hash,
    termsVersion: version,
    accepted: z.literal(true),
  }),
};
