import { z } from 'zod';
import { parseBrilStashHttpsUrl } from '../lib/brilstash/parse-https-url';

const uuid = z.uuid();

export const brilStashBuilderInputSchema = z.strictObject({
  installationId: uuid,
  merchantId: uuid,
  storefrontOrigin: z
    .string()
    .refine(
      (value) => parseBrilStashHttpsUrl(value)?.origin === value,
      'Expected a canonical HTTPS origin'
    ),
  candidateId: uuid.optional(),
});
