import { describe, expect, it } from 'vitest';
import { jumiaPreviewCacheConstants, jumiaPreviewMessages } from './constants';

describe('Jumia preview constants', () => {
  it('keeps cache namespaces distinct and lease timing bounded', () => {
    expect(jumiaPreviewCacheConstants.cachePrefix.length).toBeGreaterThan(0);
    expect(
      jumiaPreviewCacheConstants.uncertainCreationPrefix.length
    ).toBeGreaterThan(0);
    expect(jumiaPreviewCacheConstants.cachePrefix).not.toBe(
      jumiaPreviewCacheConstants.uncertainCreationPrefix
    );
    expect(jumiaPreviewCacheConstants.creationLeaseRenewalMs).toBeGreaterThan(
      0
    );
    expect(jumiaPreviewCacheConstants.creationLeaseRenewalMs).toBeLessThan(
      jumiaPreviewCacheConstants.creationLeaseMs
    );
    expect(jumiaPreviewCacheConstants.creationLeaseMs).toBeGreaterThan(0);
    expect(jumiaPreviewMessages.categoryPageSize).toBeGreaterThan(0);
  });

  it('explains safe recovery when shared storage is unavailable', () => {
    expect(jumiaPreviewMessages.sharedStorageUnavailable).toMatch(
      /cannot be created safely/i
    );
    expect(jumiaPreviewMessages.sharedStorageUnavailable).toMatch(
      /cached preview/i
    );
  });
});
