import { z } from 'zod';

// The documented default is not evidence of coverage. Require a real boolean.
export const giglAddressValidationDataSchema = z.object({
  HomeDeliveryStatus: z.boolean(),
});

export const homeDeliveryCoverageSchema = z.enum([
  'supported',
  'unsupported',
  'unavailable',
]);
export type HomeDeliveryCoverage = z.infer<typeof homeDeliveryCoverageSchema>;
