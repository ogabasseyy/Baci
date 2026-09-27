import z from 'zod';

/**
 * Shared kobo-amount primitive for PiggyVest staging webhook event schemas.
 * All money fields are integer kobo. Never mix naira and kobo.
 */
export const koboAmountSchema = z.int().nonnegative();
