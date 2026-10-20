import { z } from 'zod';
import { sanitizeUrl } from '@/lib/sanitize-core';

export const optionalHttpUrlSchema = z.preprocess(
  (value) => {
    // Normalize null → undefined so clients that serialize optional fields
    // as `null` don't hit the URL validator (which would reject them).
    if (value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmedValue = value.trim();

    return trimmedValue === '' ? undefined : trimmedValue;
  },
  z
    .url({
      error: 'Invalid URL',
    })
    .max(2048)
    .refine(
      (value) => {
        const protocol = new URL(value).protocol;

        return protocol === 'http:' || protocol === 'https:';
      },
      {
        error: 'URL must use http or https',
      }
    )
    .transform((value) => sanitizeUrl(value))
    .refine((value) => value.length > 0, {
      error: 'Invalid URL',
    })
    .optional()
);
