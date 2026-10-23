import { describe, expect, it } from 'vitest';
import {
  eligiblePreviewRequestTimeoutMs,
  jumiaPreviewCacheConstants,
  jumiaPreviewMessages,
  jumiaPreviewSelectionIdPattern,
  selectionCreationRequestTimeoutMs,
} from './constants';

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
    expect(eligiblePreviewRequestTimeoutMs).toBeGreaterThan(0);
    expect(selectionCreationRequestTimeoutMs).toBeGreaterThan(0);
  });

  it('matches canonical UUID selection IDs without accepting malformed IDs', () => {
    expect(
      jumiaPreviewSelectionIdPattern.test(
        '00000000-0000-4000-8000-000000000041'
      )
    ).toBe(true);
    expect(jumiaPreviewSelectionIdPattern.test('not-a-uuid')).toBe(false);
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
