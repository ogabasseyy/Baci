import { z } from 'zod';

/** Trims and treats a blank value as unset, like the runtime readers do. */
export const quizAttestationModeEnvSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    return value.trim() || undefined;
  },
  z.enum(['off', 'monitor', 'enforce']).default('off')
);
