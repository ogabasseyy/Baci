import { describe, expect, it } from 'vitest';
import { primarySavingsProvisioningPaginationLimits } from './primary-savings-provisioning-pagination.constants';

describe('primarySavingsProvisioningPaginationLimits', () => {
  it('pins the reviewed pagination budget', () => {
    expect(primarySavingsProvisioningPaginationLimits).toEqual({
      pageSize: 100,
      maxPages: 10,
      timeBudgetMs: 12_000,
    });
  });

  it('keeps the scan bounded', () => {
    const { pageSize, maxPages, timeBudgetMs } =
      primarySavingsProvisioningPaginationLimits;
    expect(pageSize * maxPages).toBeLessThanOrEqual(10_000);
    expect(timeBudgetMs).toBeLessThanOrEqual(30_000);
  });
});
