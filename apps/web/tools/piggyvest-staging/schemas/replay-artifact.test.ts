import { describe, expect, it } from 'vitest';
import { replayArtifactInputSchema } from './replay-artifact';

describe('replay artifact input', () => {
  it('requires every owner-selected root and rejects extra configuration', () => {
    expect(
      replayArtifactInputSchema.safeParse({
        receiverRoot: '/work/receiver/apps/web',
        savingsRoot: '/work/savings/apps/web/src',
        outputDirectory: '/work/output',
      }).success
    ).toBe(true);
    expect(
      replayArtifactInputSchema.safeParse({
        receiverRoot: '/work/receiver/apps/web',
        savingsRoot: '/work/savings/apps/web/src',
        outputDirectory: '/work/output',
        fallbackRoot: '/work/other',
      }).success
    ).toBe(false);
  });
});
