import { describe, expect, it } from 'vitest';
import { buildJumiaApprovalToastMessage } from './jumia-approval-toast';

describe('buildJumiaApprovalToastMessage', () => {
  it('includes pending and failed counts even when some products were approved', () => {
    expect(
      buildJumiaApprovalToastMessage({
        updated: 1,
        pending: 2,
        failed: 3,
      })
    ).toBe(
      '1 product approved and ready for stock sync; 2 products still pending Jumia approval; 3 products were rejected by Jumia'
    );
  });

  it('reports an empty reconciliation as having no pending feeds', () => {
    expect(buildJumiaApprovalToastMessage({})).toBe(
      'No pending Jumia product feeds found'
    );
  });

  it('gives a manual resolution path for an ambiguous submission', () => {
    expect(
      buildJumiaApprovalToastMessage({
        pending: 1,
        manualResolutionRequired: [{ sellerSku: 'SKU-UNKNOWN' }],
      })
    ).toContain(
      'Check Vendor Center before retrying; contact support if the listing is absent.'
    );
  });
});
