import { describe, expect, it } from 'vitest';
import { ADMIN_MERCHANT_SALES_ACTIVITY } from './admin-merchant-sales-activity';

describe('ADMIN_MERCHANT_SALES_ACTIVITY', () => {
  it('keeps the merchant directory and overview labels aligned for every paid-sales state', () => {
    expect(ADMIN_MERCHANT_SALES_ACTIVITY).toEqual({
      at_risk: {
        label: 'Sales Quiet',
        overviewLabel: 'Sales Quiet (31-90 Days)',
      },
      churned: {
        label: 'Sales Dormant',
        overviewLabel: 'Sales Dormant (Over 90 Days)',
      },
      healthy: { label: 'Selling', overviewLabel: 'Selling (Last 30 Days)' },
      new: {
        label: 'No Paid Sales Since Launch',
        overviewLabel: 'No Paid Sales Since Launch',
      },
    });
  });
});
