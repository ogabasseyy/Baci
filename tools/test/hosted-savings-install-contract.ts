import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const hostedSavingsInstallContract = z
  .object({
    version: z.literal(1),
    project: z.literal('baci-isolated-savings'),
    service: z.string().regex(/^[a-z][a-z0-9_-]{0,40}$/),
    containerId: sha,
    imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    dockerSocket: z
      .string()
      .regex(
        /^\/(?:var\/run\/docker\.sock|Users\/[A-Za-z0-9_-]+\/\.colima\/default\/docker\.sock)$/
      ),
    postgresSocket: z.enum(['/var/run/postgresql', '/tmp']),
    database: z.literal('postgres'),
    serverVersion: z.literal(170006),
    manifestSha256: sha,
    parentReviewed: z.literal(true),
    maintenance: z.literal(true),
    noApplicationActivity: z.literal(true),
    noExternalCredentials: z.literal(true),
    allowedNewMemberships: z
      .array(
        z
          .object({
            role: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
            member: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
          })
          .strict()
      )
      .max(32)
      .default([]),
  })
  .strict();
