import { z } from 'zod';

export const piggyvestPolicyClientSchemas = {
  configuration: z.strictObject({
    mode: z.literal('local_test'),
    baseUrl: z
      .string()
      .max(128)
      .regex(/^http:\/\/(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/?$/)
      .refine((value) => {
        const port = Number(value.match(/:([0-9]+)\/?$/)?.[1]);
        return port >= 1 && port <= 65535;
      }),
    endpointPath: z
      .string()
      .max(256)
      .regex(/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/),
    credentials: z.enum(['omit', 'same-origin', 'include']).default('omit'),
  }),
  csrf: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[!-~]+$/),
};
