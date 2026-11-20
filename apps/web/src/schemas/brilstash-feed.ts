import { z } from 'zod';
import {
  brilStashImageUrlKey,
  parseBrilStashHttpsUrl,
} from '../lib/brilstash/parse-https-url';

const httpsUrl = z
  .string()
  .refine((value) => parseBrilStashHttpsUrl(value) !== null);
const plainText = z
  .string()
  .min(1)
  .refine((value) => value === value.trim() && !/[<>\p{Cc}]/u.test(value));
export const brilstashPriceSchema = z
  .number()
  .min(0.01)
  .max(Number.MAX_SAFE_INTEGER);

export const brilstashProductSchema = z.strictObject({
  external_id: plainText,
  product_url: httpsUrl,
  title: plainText,
  description: plainText,
  category: plainText,
  price_naira: brilstashPriceSchema,
  stock_quantity: z.int().nonnegative(),
  images: z
    .array(
      z.strictObject({
        url: z.string().refine((url) => brilStashImageUrlKey(url) !== null),
      })
    )
    .min(1)
    .max(10),
  brand: plainText.optional(),
});

export type BrilStashProduct = z.infer<typeof brilstashProductSchema>;
