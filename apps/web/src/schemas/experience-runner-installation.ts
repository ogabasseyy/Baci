import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
/** Trusted release pins; never sourced from a merchant request or learned at startup. */
export const experienceRunnerInstallationPin = z.strictObject({
  format: z.literal('baci.runner-installation-pin/v1'),
  toolchainDigest: digest,
  rootfs: z.strictObject({ node24: digest, browser: digest }),
  runscDigest: digest,
  versions: z.strictObject({
    compilerNode: z.string().regex(/^v\d+\.\d+\.\d+$/),
    captureNode: z.string().regex(/^v\d+\.\d+\.\d+$/),
    runsc: z.string().regex(/^release-\d{8}\.\d+$/),
  }),
});
export type ExperienceRunnerInstallationPin = z.infer<
  typeof experienceRunnerInstallationPin
>;
