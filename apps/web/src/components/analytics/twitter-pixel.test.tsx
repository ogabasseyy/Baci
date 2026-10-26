import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitterPixel } from './twitter-pixel';

const mocks = vi.hoisted(() => ({
  getStoredConsent: vi.fn(
    () => ({ marketing: true }) as { marketing: boolean }
  ),
}));

vi.mock('@/lib/marketing-consent', () => ({
  isMarketingAllowed: () => mocks.getStoredConsent().marketing,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/product' }));

vi.mock('next/script', () => ({
  default: ({
    id,
    strategy,
    children,
    src,
  }: {
    id?: string;
    strategy?: string;
    children?: ReactNode;
    src?: string;
  }) => (
    <script data-testid={id} data-strategy={strategy} src={src}>
      {children}
    </script>
  ),
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.getStoredConsent.mockReturnValue({ marketing: true });
});

describe('TwitterPixel', () => {
  it('loads the pixel with the afterInteractive strategy when marketing consent is granted', () => {
    render(<TwitterPixel pixelId="abc" />);

    // afterInteractive (not lazyOnload): the inline bootstrap defines the
    // window.twq event-queue stub, so it must run right after hydration —
    // lazyOnload defers queue creation to window load and drops early
    // conversion events fired before then.
    const script = screen.getByTestId('twitter-pixel');
    expect(script).toHaveAttribute('data-strategy', 'afterInteractive');
    expect(script).toHaveAttribute(
      'src',
      'https://static.ads-twitter.com/uwt.js'
    );
    expect(script.textContent).not.toContain("twq('track'");
  });

  it('renders nothing when marketing consent is not granted', () => {
    mocks.getStoredConsent.mockReturnValue({ marketing: false });

    render(<TwitterPixel pixelId="abc" />);

    expect(screen.queryByTestId('twitter-pixel')).not.toBeInTheDocument();
  });

  it('renders nothing when the pixel id is empty', () => {
    render(<TwitterPixel pixelId="" />);

    expect(screen.queryByTestId('twitter-pixel')).not.toBeInTheDocument();
  });
});
