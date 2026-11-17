import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderSuccessTrackLink } from './order-success-track-link';

const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

const HREF = '/shop/track-order?token=secret-token';

function renderLink() {
  render(
    <OrderSuccessTrackLink href={HREF} className="x">
      Track My Order
    </OrderSuccessTrackLink>
  );
  return screen.getByRole('link', { name: 'Track My Order' });
}

describe('OrderSuccessTrackLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('keeps the token in the href so open-in-new-tab still works', () => {
    expect(renderLink()).toHaveAttribute('href', HREF);
  });

  it('pushes a URL without the token on a plain click and hands the token over off the URL', () => {
    const link = renderLink();

    const notPrevented = fireEvent.click(link);

    expect(notPrevented).toBe(false);
    expect(push).toHaveBeenCalledWith('/shop/track-order');
    expect(JSON.stringify(push.mock.calls)).not.toContain('secret-token');
    expect(
      JSON.parse(
        window.sessionStorage.getItem('baci:private-url-params-pending') ??
          'null'
      )?.entries
    ).toEqual([['token', 'secret-token']]);
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }],
  ])('leaves a %s click to the browser', (_label, init) => {
    const link = renderLink();

    const notPrevented = fireEvent.click(link, init);

    expect(notPrevented).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem('baci:private-url-params-pending')
    ).toBeNull();
  });

  it('lets the link navigate normally when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const link = renderLink();

    const notPrevented = fireEvent.click(link);

    expect(notPrevented).toBe(true);
    expect(push).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
