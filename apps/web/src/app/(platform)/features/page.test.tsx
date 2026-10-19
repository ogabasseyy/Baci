import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FeaturesPage from './page';

vi.mock('@/components/app-body', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/platform/header', () => ({ PlatformHeader: () => null }));
vi.mock('@/components/platform/footer', () => ({ PlatformFooter: () => null }));

describe('Baci capability documentation', () => {
  it('documents merchant operating workflows beyond storefront setup', () => {
    render(<FeaturesPage />);
    for (const title of [
      'Payments and checkout',
      'Shipping and fulfillment',
      'Domain purchase and management',
      'Jumia sales channel',
      'Invoices and receipts',
      'Team permissions',
      'Expenses and profit',
      'Customer follow-ups',
      'Bulk catalog imports',
      'Growth integrations',
      'Agent-ready commerce: ACP and UCP',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('hedges agent-protocol copy to the code-evidenced register stance', () => {
    render(<FeaturesPage />);
    expect(screen.getByText(/for authorized agents/)).toBeInTheDocument();
    expect(
      screen.getByText(/not certification, partner approval/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Baci implements Agentic Commerce Protocol/)
    ).not.toBeInTheDocument();
  });

  it('keeps plan, provider and mobile platform limitations visible', () => {
    render(<FeaturesPage />);
    expect(
      screen.getByText(/Android in-app domain purchasing is not enabled/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Availability depends on your plan, country/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/all Bumpa features/i)).not.toBeInTheDocument();
  });
});
