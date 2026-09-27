import z from 'zod';

/**
 * Shared ISO-datetime primitive for PiggyVest staging webhook event
 * schemas. Timestamps must carry an explicit offset.
 */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
