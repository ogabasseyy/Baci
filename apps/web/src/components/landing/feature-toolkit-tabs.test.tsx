import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FeatureToolkitTabs } from '@/components/landing/feature-toolkit-tabs';
import { PLATFORM_FEATURE_CATEGORIES } from '@/config/platform-features';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('FeatureToolkitTabs', () => {
  it('renders all category tabs and shows the first category panel by default', () => {
    render(<FeatureToolkitTabs />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(PLATFORM_FEATURE_CATEGORIES.length);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    // First tab ("Sell & Convert") highlights negotiations and discount codes
    expect(
      screen.getByText('Price Negotiations ("Haggling")')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Discount Codes & Promo Vouchers')
    ).toBeInTheDocument();
  });

  it('switches tab panels on click', () => {
    render(<FeatureToolkitTabs />);

    const paymentsTab = screen.getByRole('tab', { name: /Payments/i });
    fireEvent.click(paymentsTab);

    expect(paymentsTab).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByText('Ship on Credit (Deferred Virtual Account)')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Crypto Payments (USDT & USDC)')
    ).toBeInTheDocument();
  });

  it('supports keyboard navigation with ArrowRight, ArrowLeft, End, and Home', () => {
    render(<FeatureToolkitTabs />);

    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(tabs[tabs.length - 1]).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByText('Bumpa CSV Migration & Receipt-Claim Campaigns')
    ).toBeInTheDocument();

    fireEvent.keyDown(tabs[tabs.length - 1], { key: 'Home' });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(tabs[tabs.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('excludes merchant-specific Ogabassey modules from the public catalog', () => {
    render(<FeatureToolkitTabs />);

    const allTitles = PLATFORM_FEATURE_CATEGORIES.flatMap((cat) =>
      cat.items.map((item) => item.title.toLowerCase())
    );

    for (const excluded of ['repairs', 'imei', 'trade-in', 'santa', 'quiz']) {
      expect(allTitles.some((t) => t.includes(excluded))).toBe(false);
    }
  });
});
