// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TecnoBlogClickTracker } from './tecno-blog-click-tracker';

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('@/lib/posthog/capture-tecno-blog-click', () => ({
  captureTecnoBlogClick: capture,
}));

beforeEach(() => capture.mockClear());

it('tracks nested links, ignores non-links, and detaches on unmount', () => {
  const tracker = render(<TecnoBlogClickTracker />);
  render(
    <>
      <a href="https://ng-store.tecno.com/">
        <span>Order Here</span>
      </a>
      <button type="button">Other</button>
    </>
  );
  const label = screen.getByText('Order Here');
  fireEvent.click(label);
  fireEvent.click(screen.getByRole('button', { name: 'Other' }));
  tracker.unmount();
  fireEvent.click(label);

  expect(capture).toHaveBeenCalledExactlyOnceWith(
    'https://ng-store.tecno.com/'
  );
});

it('ignores a click prevented on the link', () => {
  render(
    <>
      <TecnoBlogClickTracker />
      <a
        href="https://ng-store.tecno.com/"
        onClick={(event) => event.preventDefault()}
      >
        Order Here
      </a>
    </>
  );
  expect(fireEvent.click(screen.getByRole('link'))).toBe(false);
  expect(capture).not.toHaveBeenCalled();
});

it('tracks middle-click auxclick activations and ignores non-middle auxclick buttons', () => {
  render(
    <>
      <TecnoBlogClickTracker />
      <a href="https://ng-store.tecno.com/">
        <span>Order Here</span>
      </a>
    </>
  );
  const link = screen.getByRole('link');
  link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));
  expect(capture).not.toHaveBeenCalled();

  link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
  expect(capture).toHaveBeenCalledExactlyOnceWith(
    'https://ng-store.tecno.com/'
  );
});
