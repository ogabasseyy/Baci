import { render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="dynamic-stub" />,
}));

import PrivacyPage from './page';

describe('platform privacy policy', () => {
  it('discloses the merchant connector scope and data retention', () => {
    render(<PrivacyPage />);

    expect(
      screen.getByRole('heading', { name: 'Merchant AI connectors' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot create or change orders, products, inventory/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/metadata is retained for one year; a daily purge/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not control how the service separately retains/)
    ).toBeInTheDocument();
  });
});
