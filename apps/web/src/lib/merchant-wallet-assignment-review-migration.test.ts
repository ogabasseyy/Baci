import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904123000_merchant_wallet_assignment_review.sql'
  ),
  'utf8'
);

describe('merchant wallet assignment review migration', () => {
  it('adds the assignment review issue type and open-review uniqueness', () => {
    expect(sql).toContain("'merchant_wallet_assignment_review'");
    expect(sql).toContain(
      'reconciliation_review_open_merchant_wallet_assignment_idx'
    );
    expect(sql).toContain(
      'VALIDATE CONSTRAINT reconciliation_review_issue_type_check'
    );
  });
});
