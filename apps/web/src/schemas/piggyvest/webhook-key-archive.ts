import z from 'zod';

/**
 * Retired PiggyVest webhook signing keys (R5 key lifecycle).
 *
 * PiggyVest documents a single business secret key. When it rotates, the
 * operator moves the old value into this archive with the instant it was
 * retired:
 * - for a bounded overlap window after `retiredAt` (default 72 hours) the
 *   old key is still accepted for NEW deliveries, so in-flight provider
 *   retries signed before the rotation are captured rather than lost;
 * - after the window the key is revoked at ingress and only ever re-checks
 *   bodies that were already stored (replay).
 */
export const piggyvestWebhookKeyFamilySchema = z.enum([
  'legacy',
  'bank',
  'custody',
  'interest',
]);

const archivedKeySchema = z.strictObject({
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  family: piggyvestWebhookKeyFamilySchema,
  secret: z
    .string()
    .max(1024)
    .refine((value) => value.trim().length > 0),
  retiredAt: z.iso.datetime({ offset: true }),
});

export const piggyvestWebhookKeyArchiveSchema = z
  .array(archivedKeySchema)
  .max(24)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.version)).size === entries.length,
    { message: 'Archived key versions must be unique' }
  );

export type PiggyvestArchivedWebhookKey = z.infer<typeof archivedKeySchema>;

/**
 * Separate, bounded input for constructors that re-validate the
 * operator-configured retained list with their own caps: the derived
 * archive-sourced verification keys travel next to it, never inside it.
 */
export const piggyvestArchivedVerificationSecretsSchema = z
  .array(z.string().min(1).max(4096))
  .max(8)
  .default([]);
