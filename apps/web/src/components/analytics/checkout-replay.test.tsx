// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CheckoutReplay } from './checkout-replay';

const mocks = vi.hoisted(() => ({
  getPathname: vi.fn(),
  waitForLcpWindowEnd: vi.fn(),
  initializePostHogBrowser: vi.fn(),
  get_session_id: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: mocks.getPathname }));
vi.mock('@/lib/posthog/config', () => ({
  getPostHogBrowserEnv: () => ({
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_test',
  }),
}));
vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: mocks.waitForLcpWindowEnd,
}));
vi.mock('@/lib/posthog/browser', () => ({
  initializePostHogBrowser: mocks.initializePostHogBrowser,
}));
vi.mock('posthog-js', () => ({ default: mocks }));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/checkout');
  mocks.getPathname.mockImplementation(() => window.location.pathname);
  mocks.waitForLcpWindowEnd.mockResolvedValue(undefined);
  mocks.get_session_id.mockReturnValue('0190123f-1212-7222-8111-000000000001');
});
afterEach(cleanup);

it('starts on checkout and stops when leaving it', async () => {
  const { rerender } = render(<CheckoutReplay enabled />);
  await vi.waitFor(() =>
    expect(mocks.startSessionRecording).toHaveBeenCalledOnce()
  );
  window.history.replaceState(null, '', '/products/phone');
  rerender(<CheckoutReplay enabled />);
  expect(mocks.stopSessionRecording).toHaveBeenCalledOnce();
  expect(mocks.startSessionRecording).toHaveBeenCalledOnce();
});

it('stays off when disabled and when opening a saved Oxygen application', async () => {
  const { rerender } = render(<CheckoutReplay enabled={false} />);
  expect(mocks.waitForLcpWindowEnd).not.toHaveBeenCalled();
  window.history.replaceState(null, '', '/checkout?oxygenOrderId=test');
  rerender(<CheckoutReplay enabled />);
  await act(async () => {});
  expect(mocks.startSessionRecording).not.toHaveBeenCalled();
});

it('does not start if the shopper leaves during the defer window', async () => {
  let release: () => void = () => {};
  mocks.waitForLcpWindowEnd.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  const { unmount } = render(<CheckoutReplay enabled />);
  unmount();
  await act(async () => {
    release();
  });
  expect(mocks.startSessionRecording).not.toHaveBeenCalled();
});

it('skips the recorder for sessions outside the pilot sample', async () => {
  mocks.get_session_id.mockReturnValue('0190123f-1212-7222-8111-0000ffffffff');
  render(<CheckoutReplay enabled />);
  await vi.waitFor(() => expect(mocks.get_session_id).toHaveBeenCalledOnce());
  expect(mocks.startSessionRecording).not.toHaveBeenCalled();
});
