import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseMerchantSafe = vi.fn();
const mockUseBoundaryErrorReport = vi.fn();

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('@/hooks/merchant/use-merchant', () => ({
  useMerchantSafe: () => mockUseMerchantSafe(),
}));

vi.mock('@/hooks/use-boundary-error-report', () => ({
  useBoundaryErrorReport: (...args: unknown[]) =>
    mockUseBoundaryErrorReport(...args),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (value: string) => value,
}));

import StorefrontError from './error';

describe('StorefrontError', () => {
  beforeEach(() => {
    mockUseMerchantSafe.mockReset();
    mockUseMerchantSafe.mockReturnValue({ basePath: '/ogabassey' });
    mockUseBoundaryErrorReport.mockReset();
    mockUseBoundaryErrorReport.mockReturnValue(false);
  });

  it('renders the storefront error card and reports the error when no recovery is pending', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('storefront boom'), {
      digest: 'digest-1',
    });

    render(<StorefrontError error={error} reset={reset} />);

    expect(
      screen.getByRole('heading', { name: /something went wrong/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
    expect(mockUseBoundaryErrorReport).toHaveBeenCalledWith(error, {
      routeSurface: 'storefront',
      logLabel: 'Storefront error',
      properties: { storefront_base_path: '/ogabassey' },
    });
  });

  it('renders the chunk-recovery notice instead of the error card while a reload is pending', () => {
    mockUseBoundaryErrorReport.mockReturnValue(true);

    render(<StorefrontError error={new Error('chunk boom')} reset={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      /updating to the latest version/i
    );
    expect(
      screen.queryByRole('heading', { name: /something went wrong/i })
    ).not.toBeInTheDocument();
  });
});
