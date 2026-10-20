import { describe, expect, it } from 'vitest';
import { describeRefundManageBlocked } from './describe-refund-manage-blocked';

describe('refund manage-blocked labels', () => {
  it('explains in-flight steps as processing', () => {
    expect(describeRefundManageBlocked('processing')).toContain(
      'being processed'
    );
  });
  it('explains review steps as under review', () => {
    expect(describeRefundManageBlocked('requires_review')).toContain(
      'under review'
    );
  });
  it('keeps the permission message otherwise', () => {
    for (const status of ['failed', 'queued', 'not_started'])
      expect(describeRefundManageBlocked(status)).toContain(
        'refund permission'
      );
  });
});
