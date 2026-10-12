import { z } from 'zod';

export const piggyvestProviderIdSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      value.isWellFormed() &&
      !value.includes('\0') &&
      new TextEncoder().encode(value).length <= 512
  );
