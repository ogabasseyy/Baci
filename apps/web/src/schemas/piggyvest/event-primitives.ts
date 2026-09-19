import z from 'zod';

/**
 * Shared field primitives for PiggyVest staging webhook event schemas.
 *
 * All money fields are integer kobo. Never mix naira and kobo.
 */

export const koboAmountSchema = z.int().nonnegative();

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const nullableStringSchema = z.string().nullable();
