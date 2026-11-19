import { z } from 'zod';
import { parseBrilStashStorefrontOrigin } from '../lib/brilstash/parse-https-url';

const uuid = z.uuid();

export const brilStashBuilderInputSchema = z.strictObject({
  installationId: uuid,
  merchantId: uuid,
  storefrontOrigin: z.string().transform((value, ctx) => {
    const origin = parseBrilStashStorefrontOrigin(value);
    if (origin) return origin;
    ctx.addIssue({
      code: 'custom',
      message: 'Expected a canonical HTTPS origin',
    });
    return z.NEVER;
  }),
  candidateId: uuid.optional(),
});
