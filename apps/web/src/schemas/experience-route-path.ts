import { z } from 'zod';

/** Canonical route contract shared by performance reports and worker protocol. */
export const experienceCanonicalRoutePathSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^\/(?!\/)/);
