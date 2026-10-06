import { z } from 'zod';
import { piggyvestPolicyTextByteLength } from './piggyvest-policy-text-byte-length';

function boundedText(maximum: number) {
  return z
    .string()
    .min(1)
    .max(maximum)
    .refine(
      (value) =>
        value.trim().length > 0 &&
        Number.isFinite(piggyvestPolicyTextByteLength(value)) &&
        !Array.from(value).some(
          (character) =>
            character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127
        )
    );
}

export const piggyvestFundingDisplaySchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    accounts: z
      .array(
        z.strictObject({
          accountNumber: boundedText(64),
          accountName: boundedText(256),
          bankName: boundedText(256),
        })
      )
      .min(1)
      .max(32),
  }),
  z.strictObject({ status: z.literal('pending') }),
  z.strictObject({ status: z.literal('unavailable') }),
]);
