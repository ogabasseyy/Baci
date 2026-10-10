import { describe, expect, it, vi } from 'vitest';
import { runCustomerSavingsDraftStandalonePreparationCli } from './customer-savings-draft-standalone-preparation-cli';

describe('runCustomerSavingsDraftStandalonePreparationCli', () => {
  it('creates a source snapshot from explicit repository and destination paths', async () => {
    const createSnapshot = vi.fn().mockResolvedValue({
      manifestPath: '/snapshot/customer-savings-draft-source-manifest.json',
      revision: 'a'.repeat(40),
    });

    await expect(
      runCustomerSavingsDraftStandalonePreparationCli(
        ['snapshot', '/reviewed/source', '/isolated/snapshot'],
        { createSnapshot }
      )
    ).resolves.toEqual({
      manifestPath: '/snapshot/customer-savings-draft-source-manifest.json',
      revision: 'a'.repeat(40),
    });
    expect(createSnapshot).toHaveBeenCalledWith({
      repositoryRoot: '/reviewed/source',
      destination: '/isolated/snapshot',
    });
  });
});
