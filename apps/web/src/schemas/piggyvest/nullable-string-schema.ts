import z from 'zod';

/**
 * Shared nullable-string primitive for PiggyVest staging webhook event
 * schemas. Optional provider metadata arrives as a string or explicit null.
 */
export const nullableStringSchema = z.string().nullable();
