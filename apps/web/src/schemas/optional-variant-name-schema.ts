import { z } from 'zod';
import { sanitizeText } from '@/lib/sanitize-core';

export const optionalVariantNameSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z
    .string()
    .optional()
    .transform((val) => {
      if (!val) {
        return val;
      }

      const sanitized = sanitizeText(val).trim();
      return sanitized.length > 0 ? sanitized : undefined;
    })
);
