import { z } from 'zod';

export const HostedStagingPushPreflightInputSchema = z
  .object({
    pins: z.unknown(),
    manifest: z.unknown().optional(),
    easConfig: z.unknown(),
    installedApplicationId: z.string().min(1).optional(),
    installedPlatform: z.enum(['android', 'ios']).optional(),
  })
  .refine(
    ({ installedApplicationId, installedPlatform }) =>
      (installedApplicationId === undefined) ===
      (installedPlatform === undefined),
    'Installed application id and platform must be supplied together'
  );
