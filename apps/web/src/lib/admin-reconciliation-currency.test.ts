import { describe, expect, it } from 'vitest';
import { formatAdminReconciliationMoney } from './admin-reconciliation-currency';

describe('formatAdminReconciliationMoney', () => {
  it('renders each total in its selected currency', () => {
    expect(formatAdminReconciliationMoney(25, 'USD')).toContain('$');
    expect(formatAdminReconciliationMoney(25, 'NGN')).toContain('₦');
  });

  it('does not label unverified currency amounts as naira', () => {
    expect(formatAdminReconciliationMoney(1200, 'UNK')).toContain('UNK');
    expect(formatAdminReconciliationMoney(1200, 'UNK')).not.toContain('₦');
  });
});
