import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapchatPixel } from './snapchat-pixel';

const mocks = vi.hoisted(() => ({
  getStoredConsent: vi.fn(
    () => ({ marketing: true }) as { marketing: boolean }
  ),
}));

vi.mock('@/lib/consent-mode', () => ({
  getStoredConsent: mocks.getStoredConsent,
}));

vi.mock('next/script', () => ({
  default: ({
    id,
    strategy,
    children,
  }: {
    id?: string;
    strategy?: string;
    children?: ReactNode;
  }) => (
    <script data-testid={id} data-strategy={strategy}>
      {children}
    </script>
  ),
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.getStoredConsent.mockReturnValue({ marketing: true });
});

describe('SnapchatPixel', () => {
  it('loads the pixel with the afterInteractive strategy when marketing consent is granted', () => {
    render(<SnapchatPixel pixelId="11111111-1111-4111-8111-111111111111" />);

    // afterInteractive (not lazyOnload): the inline bootstrap defines the
    // window.snaptr event-queue stub, so it must run right after hydration —
    // lazyOnload defers queue creation to window load and drops early
    // conversion events fired before then.
    const script = screen.getByTestId(
      'snapchat-pixel-11111111-1111-4111-8111-111111111111'
    );
    expect(script).toHaveAttribute('data-strategy', 'afterInteractive');
    expect(script.textContent).toContain(
      "snaptr('init', '11111111-1111-4111-8111-111111111111'"
    );
    expect(script.textContent).not.toContain('__INSERT_USER_EMAIL__');
    expect(script.textContent).not.toContain('user_email');
  });

  it('renders nothing when marketing consent is not granted', () => {
    mocks.getStoredConsent.mockReturnValue({ marketing: false });

    render(<SnapchatPixel pixelId="11111111-1111-4111-8111-111111111111" />);

    expect(
      screen.queryByTestId(
        'snapchat-pixel-11111111-1111-4111-8111-111111111111'
      )
    ).not.toBeInTheDocument();
  });

  it('renders nothing when the pixel id is empty', () => {
    render(<SnapchatPixel pixelId="" />);

    expect(
      screen.queryByTestId(
        'snapchat-pixel-11111111-1111-4111-8111-111111111111'
      )
    ).not.toBeInTheDocument();
  });
});
