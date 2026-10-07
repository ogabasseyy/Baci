import { z } from 'zod';

const responseData = z.object({}).passthrough();

export const prefundedCardCheckoutProviderResponseSchemas = {
  initialize: z
    .object({
      status: z.boolean(),
      data: responseData.optional(),
    })
    .passthrough(),
  verify: z
    .object({
      status: z.boolean(),
      data: responseData.optional(),
    })
    .passthrough(),
};
