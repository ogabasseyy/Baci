import type { ImeiServiceTierKey } from '@baci/shared/imei';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OgabasseyImeiChecker } from './imei-checker';
import { getDisplayTier } from './imei-checker-tiers';

const fetchMock = vi.fn();
const mocks = vi.hoisted(() => ({
  useMerchantSafe: vi.fn(),
  availableTierKeys: null as ImeiServiceTierKey[] | null,
  availabilityFailed: false,
  retryAvailability: vi.fn(),
}));

vi.stubGlobal('fetch', fetchMock);

vi.mock('./use-imei-runtime-availability', () => ({
  useImeiRuntimeAvailability: () => ({
    availableTierKeys: mocks.availableTierKeys,
    failed: mocks.availabilityFailed,
    loading: false,
    retry: mocks.retryAvailability,
  }),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    // biome-ignore lint/a11y/useAltText: alt is spread from props.
    // biome-ignore lint/performance/noImgElement: test stub for next/image.
    <img {...props} alt={String(props.alt ?? '')} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: mocks.useMerchantSafe,
}));

describe('IMEI runtime availability and approved price display', () => {
  beforeEach(() => {
    mocks.availableTierKeys = null;
    mocks.availabilityFailed = false;
    mocks.retryAvailability.mockClear();
    document.cookie = 'csrf-token=test-csrf-token; path=/';
    fetchMock.mockReset();
    mocks.useMerchantSafe.mockReturnValue({
      basePath: '/ogabassey',
      merchant: { slug: 'ogabassey' },
    });
  });

  const tierButtonName = (tierKey: ImeiServiceTierKey) => {
    const tier = getDisplayTier(tierKey);
    return `${tier.name}, ${tier.tagline}, ${tier.priceDisplay}`;
  };

  it('honors explicit empty capabilities with an accessible retry and disabled verification', () => {
    mocks.availableTierKeys = [];
    render(<OgabasseyImeiChecker />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'No checks are available for this selection.'
    );
    expect(
      screen.queryByRole('radio', { name: tierButtonName('full') })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry available checks' })
    );
    expect(mocks.retryAvailability).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Choose a check' })
    ).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retains legacy checks after a capability error while hiding provider-only checks and offering retry', () => {
    mocks.availabilityFailed = true;
    render(<OgabasseyImeiChecker />);
    expect(
      screen.getByRole('radio', { name: tierButtonName('full') })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More checks' }));
    expect(
      screen.queryByRole('radio', { name: tierButtonName('esimCompatibility') })
    ).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Some services could not be checked.'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry available checks' })
    );
    expect(mocks.retryAvailability).toHaveBeenCalledOnce();
  });

  it('shows eSIM only when advertised and prevents billing a revoked selection', () => {
    const { rerender } = render(<OgabasseyImeiChecker />);
    fireEvent.click(screen.getByRole('button', { name: 'More checks' }));
    expect(
      screen.queryByRole('radio', { name: tierButtonName('esimCompatibility') })
    ).toBeNull();
    mocks.availableTierKeys = ['full', 'esimCompatibility'];
    rerender(<OgabasseyImeiChecker />);
    fireEvent.click(
      screen.getByRole('radio', { name: tierButtonName('esimCompatibility') })
    );
    expect(
      screen.getByRole('button', { name: /Verify Now · ₦400/ })
    ).toBeInTheDocument();
    mocks.availableTierKeys = [];
    rerender(<OgabasseyImeiChecker />);
    expect(
      screen.getByRole('button', { name: 'Choose a check' })
    ).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
