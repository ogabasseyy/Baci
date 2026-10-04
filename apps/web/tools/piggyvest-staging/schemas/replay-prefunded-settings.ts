import { z } from 'zod';
import type { PrefundedReceiptReplay } from '../replay-prefunded';

type ReplayRuntime = Pick<PrefundedReceiptReplay, 'resolveEnrollment' | 'replay'>;
type RuntimeFactory = (input: {
  configuration: unknown;
  expectedAppSystemId: string;
  fetchImplementation: typeof fetch;
}) => Promise<ReplayRuntime>;

const digest = z.string().regex(/^[a-f0-9]{64}$/);

export const replayPrefundedSettings = {
  activation: z.strictObject({
    bundleSha256: digest,
    configurationSha256: digest,
  }),
  module: z.object({
    createPrefundedCardReplayRuntime: z.custom<RuntimeFactory>(
      (value) => typeof value === 'function'
    ),
  }),
  runtime: z.strictObject({
    resolveEnrollment: z.custom<ReplayRuntime['resolveEnrollment']>(
      (value) => typeof value === 'function'
    ),
    replay: z.custom<ReplayRuntime['replay']>(
      (value) => typeof value === 'function'
    ),
  }),
};
