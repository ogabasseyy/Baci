export const ADMIN_MERCHANT_SALES_ACTIVITY = {
  at_risk: {
    label: 'Sales Quiet',
    overviewLabel: 'Sales Quiet (31-90 Days)',
  },
  churned: {
    label: 'Sales Dormant',
    overviewLabel: 'Sales Dormant (Over 90 Days)',
  },
  healthy: {
    label: 'Selling',
    overviewLabel: 'Selling (Last 30 Days)',
  },
  new: {
    label: 'No Paid Sales Since Launch',
    overviewLabel: 'No Paid Sales Since Launch',
  },
} as const;
