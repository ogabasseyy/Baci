import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitterPixel } from './twitter-pixel';

const mocks = vi.hoisted(() => ({
  onReady: undefined as (() => void) | undefined,
  pathname: '/product',
  getStoredConsent: vi.fn(
    () => ({ marketing: true }) as { marketing: boolean }
  ),
}));

vi.mock('@/lib/marketing-consent', () => ({
  isMarketingAllowed: () => mocks.getStoredConsent().marketing,
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

vi.mock('next/script', () => ({
  default: ({
    id,
    strategy,
    children,
    src,
    onReady,
  }: {
    id?: string;
    strategy?: string;
    children?: ReactNode;
    src?: string;
    onReady?: () => void;
  }) => {
    mocks.onReady = onReady;
    return (
      <script data-testid={id} data-strategy={strategy} src={src}>
        {children}
      </script>
    );
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  delete window.twq;
  mocks.pathname = '/product';
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

it('does not duplicate page views for equal maps, and supports cached-ready navigation', () => {
  const sdk = vi.fn();
  window.twq = sdk;
  const { rerender } = render(
    <TwitterPixel pixelId="abc" eventIds={{ pageView: 'tw-abc-page' }} />
  );
  expect(sdk).not.toHaveBeenCalled();
  act(() => mocks.onReady?.());
  expect(sdk.mock.calls.filter(([action]) => action === 'event')).toHaveLength(
    1
  );
  rerender(
    <TwitterPixel pixelId="abc" eventIds={{ pageView: 'tw-abc-page' }} />
  );
  expect(sdk.mock.calls.filter(([action]) => action === 'event')).toHaveLength(
    1
  );
  mocks.pathname = '/cart';
  rerender(
    <TwitterPixel pixelId="abc" eventIds={{ pageView: 'tw-abc-page' }} />
  );
  expect(sdk.mock.calls.filter(([action]) => action === 'event')).toHaveLength(
    2
  );
  act(() => mocks.onReady?.());
  expect(sdk.mock.calls.filter(([action]) => action === 'event')).toHaveLength(
    2
  );
});
it('drops A page observations on tenant switch before readiness', () => {
  const sdk = vi.fn();
  window.twq = sdk;
  const { rerender } = render(
    <TwitterPixel pixelId="abc" eventIds={{ pageView: 'tw-abc-page' }} />
  );
  rerender(
    <TwitterPixel pixelId="new" eventIds={{ pageView: 'tw-new-page' }} />
  );
  act(() => mocks.onReady?.());
  expect(sdk).not.toHaveBeenCalledWith(
    'event',
    'tw-abc-page',
    expect.anything()
  );
  expect(sdk).toHaveBeenCalledWith(
    'event',
    'tw-new-page',
    expect.objectContaining({ conversion_id: expect.any(String) })
  );
});
it('drops pending observations after revocation before readiness', () => {
  const sdk = vi.fn();
  window.twq = sdk;
  render(<TwitterPixel pixelId="abc" eventIds={{ pageView: 'tw-abc-page' }} />);
  const oldReady = mocks.onReady;
  act(() => {
    mocks.getStoredConsent.mockReturnValue({ marketing: false });
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  act(() => oldReady?.());
  expect(sdk).not.toHaveBeenCalled();
});

it('dispatches one page view on a fresh mount with an already cached SDK', () => {
  const sdk = vi.fn();
  window.twq = sdk;
  const first = render(
    <TwitterPixel pixelId="abc" eventIds={{ pageView: 'tw-abc-page' }} />
  );
  act(() => mocks.onReady?.());
  first.unmount();
  sdk.mockClear();
  render(<TwitterPixel pixelId="abc" eventIds={{ pageView: 'tw-abc-page' }} />);
  expect(sdk).not.toHaveBeenCalled();
  act(() => mocks.onReady?.());
  act(() => mocks.onReady?.());
  expect(sdk.mock.calls.filter(([action]) => action === 'event')).toHaveLength(
    1
  );
});
