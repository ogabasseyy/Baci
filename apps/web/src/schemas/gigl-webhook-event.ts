import z from 'zod';

/** GIG waybills are numeric today; allow alphanumerics for international. */
export const GIGL_WAYBILL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

const waybillSchema = z.preprocess(
  (value) => (typeof value === 'number' ? String(value) : value),
  z.string().trim().regex(GIGL_WAYBILL_PATTERN)
);

// Informational fields never decide anything, so an odd value (too long,
// wrong type) becomes null instead of rejecting a genuine delivery that GIG
// would otherwise retry forever.
const optionalTextSchema = (maxLength: number) =>
  z.string().trim().max(maxLength).nullish().catch(null);

/**
 * Decrypted GIG status webhook. Only the fields Baci acts on are kept:
 * SenderAddress and ReceiverAddress are deliberately not declared, so
 * Zod strips them and customer addresses never travel past the parser.
 */
export const giglWebhookEventSchema = z.object({
  Waybill: waybillSchema,
  UserId: z.string().trim().min(1).max(128),
  ChannelCode: z.string().trim().min(1).max(64),
  Status: optionalTextSchema(256),
  StatusCode: optionalTextSchema(32),
  Location: optionalTextSchema(512),
});

export type GiglWebhookEvent = z.infer<typeof giglWebhookEventSchema>;
