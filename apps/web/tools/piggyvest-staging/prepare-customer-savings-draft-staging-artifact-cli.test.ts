import { describe, expect, it, vi } from 'vitest';
import { runPrepareCustomerSavingsDraftStagingArtifactCli } from './prepare-customer-savings-draft-staging-artifact-cli';

describe('runPrepareCustomerSavingsDraftStagingArtifactCli', () => {
  it('passes one artifact directory to the finalizer', async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);

    await runPrepareCustomerSavingsDraftStagingArtifactCli(
      ['/tmp/reviewed-artifact/.vercel/output'],
      prepare
    );

    expect(prepare).toHaveBeenCalledWith(
      '/tmp/reviewed-artifact/.vercel/output'
    );
  });

  it.each([
    [],
    ['one', 'two'],
  ])('rejects an invalid argument count', async (args) => {
    await expect(
      runPrepareCustomerSavingsDraftStagingArtifactCli(args)
    ).rejects.toThrow('Usage: prepare-customer-savings-draft-staging-artifact');
  });
});
