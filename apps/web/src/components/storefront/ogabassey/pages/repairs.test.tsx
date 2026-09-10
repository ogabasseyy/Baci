import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyV2Repairs } from './repairs';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (path: string) => path,
}));

const mockRepairDevicePicker = vi.fn();

vi.mock('@/components/storefront/repairs/RepairDevicePicker', () => ({
  RepairDevicePicker: (props: Record<string, unknown>) => {
    mockRepairDevicePicker(props);
    return <div data-testid="device-picker" />;
  },
}));

describe('OgabasseyV2Repairs', () => {
  it('links repair and swap actions at the custom-domain root', () => {
    render(<OgabasseyV2Repairs basePath="" />);

    expect(
      screen.getByRole('link', { name: /book a repair/i })
    ).toHaveAttribute('href', '/repair');
    expect(
      screen.getByRole('link', { name: /trade-in instead/i })
    ).toHaveAttribute('href', '/swap');
  });

  it('keeps path-based storefront links under the merchant slug', () => {
    render(<OgabasseyV2Repairs basePath="/ogabassey" />);

    expect(
      screen.getByRole('link', { name: /book a repair/i })
    ).toHaveAttribute('href', '/ogabassey/repair');
    expect(
      screen.getByRole('link', { name: /trade-in instead/i })
    ).toHaveAttribute('href', '/ogabassey/swap');
    expect(screen.getByRole('link', { name: /visit store/i })).toHaveAttribute(
      'href',
      '/ogabassey'
    );
  });

  it('normalizes fallback and trailing-slash storefront paths', () => {
    const { rerender } = render(<OgabasseyV2Repairs storeSlug="ogabassey" />);

    expect(
      screen.getByRole('link', { name: /book a repair/i })
    ).toHaveAttribute('href', '/ogabassey/repair');
    expect(
      screen.getByRole('link', { name: /trade-in instead/i })
    ).toHaveAttribute('href', '/ogabassey/swap');

    rerender(<OgabasseyV2Repairs basePath="/ogabassey/" />);

    expect(
      screen.getByRole('link', { name: /book a repair/i })
    ).toHaveAttribute('href', '/ogabassey/repair');
    expect(
      screen.getByRole('link', { name: /trade-in instead/i })
    ).toHaveAttribute('href', '/ogabassey/swap');
  });

  it('renders the repair lab content and the static fallback services when no catalogue groups are provided', () => {
    render(<OgabasseyV2Repairs />);

    expect(
      screen.getByRole('heading', { name: /repair lab/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/don't ditch it/i)).toBeInTheDocument();
    expect(screen.getByText('Screen Renewal')).toBeInTheDocument();
    expect(screen.getByText('Battery Boost')).toBeInTheDocument();
    expect(screen.queryByTestId('device-picker')).not.toBeInTheDocument();
  });

  it('renders the catalogue-driven device picker instead of the static services when groups are provided', () => {
    const groups = [
      {
        brand: 'Apple',
        devices: [
          {
            id: 'd1',
            brand: 'Apple',
            model: 'iPhone 13',
            slug: 'apple-iphone-13',
            deviceType: 'Smartphone' as const,
            imageUrl: null,
            productId: null,
          },
        ],
      },
    ];

    render(<OgabasseyV2Repairs basePath="/ogabassey" groups={groups} />);

    expect(screen.getByTestId('device-picker')).toBeInTheDocument();
    expect(screen.queryByText('Screen Renewal')).not.toBeInTheDocument();
    expect(mockRepairDevicePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        basePath: '/ogabassey',
        groups,
        notListedHref: '/ogabassey/repair',
      })
    );
  });

  it('omits the branded lab hero when omitHero is set', () => {
    render(<OgabasseyV2Repairs omitHero />);

    expect(
      screen.queryByRole('heading', { name: /repair lab/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/don't ditch it/i)).not.toBeInTheDocument();
    expect(screen.getByText('Screen Renewal')).toBeInTheDocument();
  });

  it('renders the device picker (with its own empty state) when groups is an empty array', () => {
    render(<OgabasseyV2Repairs basePath="/ogabassey" groups={[]} />);

    expect(screen.getByTestId('device-picker')).toBeInTheDocument();
    expect(screen.queryByText('Screen Renewal')).not.toBeInTheDocument();
  });
});
