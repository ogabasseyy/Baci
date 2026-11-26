import { z } from 'zod';

export const experienceToolchainDigest = z.string().regex(/^[a-f0-9]{64}$/);
/** Trusted release pins; never sourced from a merchant request or learned at startup. */
export const experienceRunnerInstallationPin = z.strictObject({
  format: z.literal('baci.runner-installation-pin/v2'),
  toolchainDigest: experienceToolchainDigest,
  rootfs: z.strictObject({
    node24: experienceToolchainDigest,
    browser: experienceToolchainDigest,
  }),
  runscDigest: experienceToolchainDigest,
  gvisorBinDigest: experienceToolchainDigest,
  versions: z.strictObject({
    compilerNode: z.string().regex(/^v\d+\.\d+\.\d+$/),
    captureNode: z.string().regex(/^v\d+\.\d+\.\d+$/),
    runsc: z.string().regex(/^release-\d{8}\.\d+$/),
  }),
});
export type ExperienceRunnerInstallationPin = z.infer<
  typeof experienceRunnerInstallationPin
>;
