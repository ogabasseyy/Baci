import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { MerchantHealthBadge } from '@/app/admin/merchants/merchant-health-badge';

describe('MerchantHealthBadge', () => {
  it.each([
    ['healthy', 'Selling', 'emerald'],
    ['at_risk', 'Sales Quiet', 'amber'],
    ['churned', 'Sales Dormant', 'destructive'],
    ['new', 'No Paid Sales Since Launch', 'indigo'],
  ] as const)('renders %s as %s with a decorative icon', (status, label, classFragment) => {
    const { container } = render(<MerchantHealthBadge status={status} />);
    const badge = screen.getByRole('status', { name: label });

    expect(badge).toBeVisible();
    expect(badge.className).toContain(classFragment);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ] as const)('renders %s status gracefully', (_label, status) => {
    render(
      <MerchantHealthBadge
        status={status as ComponentProps<typeof MerchantHealthBadge>['status']}
      />
    );

    expect(screen.getByRole('status', { name: 'Unknown' })).toBeVisible();
  });

  it('renders unknown statuses as fallback text', () => {
    render(<MerchantHealthBadge status="paused" />);

    expect(screen.getByRole('status', { name: 'paused' })).toBeVisible();
  });
});
