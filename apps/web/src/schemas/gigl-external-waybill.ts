import { z } from 'zod';

/** GIG waybills are numeric today; allow the short alphanumeric forms too. */
export const GIGL_EXTERNAL_WAYBILL_PATTERN = /^[A-Za-z0-9-]{4,32}$/;

export const giglExternalWaybillRequestSchema = z
  .object({
    action: z.enum(['preview', 'link']),
    waybill: z
      .string()
      .trim()
      .regex(GIGL_EXTERNAL_WAYBILL_PATTERN, 'Enter a valid GIG waybill number'),
  })
  .strict();

export const giglExternalWaybillOrderIdSchema = z.uuid();

export type GiglExternalWaybillRequest = z.infer<
  typeof giglExternalWaybillRequestSchema
>;
