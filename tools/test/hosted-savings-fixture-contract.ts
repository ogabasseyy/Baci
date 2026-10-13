import { z } from 'zod';
import { hostedSavingsInstallContract } from './hosted-savings-install-contract';

export const hostedSavingsFixtureContract = z
  .object({
    destination: hostedSavingsInstallContract,
    systemIdentifier: z.string().regex(/^[1-9][0-9]{0,19}$/),
    installed: z
      .object({
        status: z.literal('installed'),
        manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
        completed: z.number().int().positive(),
        claimed: z.literal(true),
        containerId: z.string().regex(/^[a-f0-9]{64}$/),
        imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      })
      .strict(),
    ownerId: z.string().uuid(),
    customerActorId: z.string().uuid(),
    fixtureReviewed: z.literal(true),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.ownerId === input.customerActorId ||
      input.installed.containerId !== input.destination.containerId ||
      input.installed.imageId !== input.destination.imageId ||
      input.installed.manifestSha256 !== input.destination.manifestSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture receipt identity mismatch',
      });
    }
  });
