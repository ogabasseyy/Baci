import { z } from 'zod';

// Every key is required, so a fork that renamed or dropped one reads as
// unreadable (503), never as zeros. Times may be null (nothing to average) and
// arrive as numbers or numeric strings; negatives and junk time values read as no data, but a corrupt count is
// rejected as unreadable.
const count = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed =
    typeof value === 'string' && value.trim() === ''
      ? Number.NaN
      : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    // Corrupt counts are unreadable, never a confident zero.
    ctx.addIssue({ code: 'custom', message: 'invalid count' });
    return z.NEVER;
  }
  return Math.trunc(parsed);
});

const seconds = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => {
    if (value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
  });

/** Provider summary: only the fields the Baci insights card reads. */
export const providerInboxSummarySchema = z.object({
  conversations_count: count,
  incoming_messages_count: count,
  outgoing_messages_count: count,
  resolutions_count: count,
  avg_first_response_time: seconds,
  avg_resolution_time: seconds,
});
