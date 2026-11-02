import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { prepareXPixel } from '@/lib/x-ads/pixel-client';
import { usePreparedTwitterPixel } from './use-prepared-twitter-pixel';

vi.mock('@/lib/x-ads/pixel-client', () => ({ prepareXPixel: vi.fn() }));
const consent = (marketing: boolean) =>
  JSON.stringify({
    necessary: true,
    functional: true,
    analytics: true,
    marketing,
  });
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
it('releases the old owner and rotates the epoch when consent is withdrawn and restored in a batch', () => {
  const first = vi.fn();
  const second = vi.fn();
  vi.mocked(prepareXPixel)
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second);
  localStorage.setItem('baci-cookie-consent', consent(true));
  const view = renderHook(() =>
    usePreparedTwitterPixel('merchant-a', 'abc', '{"addToCart":"tw-abc-cart"}')
  );
  expect(prepareXPixel).toHaveBeenCalledWith(
    'abc',
    { addToCart: 'tw-abc-cart' },
    'merchant-a'
  );
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(false));
    window.dispatchEvent(new Event('cookie-consent-updated'));
    expect(first).toHaveBeenCalledOnce();
    localStorage.setItem('baci-cookie-consent', consent(true));
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  expect(view.result.current).toBe(1);
  expect(prepareXPixel).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(second).toHaveBeenCalledOnce();
});
it('releases ownership before preparing a different merchant or event mapping', () => {
  localStorage.setItem('baci-cookie-consent', consent(true));
  const first = vi.fn();
  const second = vi.fn();
  vi.mocked(prepareXPixel)
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second);
  const view = renderHook(
    ({ merchant, eventIds }) =>
      usePreparedTwitterPixel(merchant, 'abc', eventIds),
    { initialProps: { merchant: 'merchant-a', eventIds: '{}' } }
  );
  view.rerender({
    merchant: 'merchant-b',
    eventIds: '{"addToCart":"tw-abc-cart"}',
  });
  expect(first).toHaveBeenCalledOnce();
  expect(prepareXPixel).toHaveBeenLastCalledWith(
    'abc',
    { addToCart: 'tw-abc-cart' },
    'merchant-b'
  );
  view.unmount();
  expect(second).toHaveBeenCalledOnce();
});
it('does not prepare a pixel without marketing consent', () => {
  localStorage.setItem('baci-cookie-consent', consent(false));
  const view = renderHook(() =>
    usePreparedTwitterPixel('merchant-a', 'abc', '{}')
  );
  expect(prepareXPixel).not.toHaveBeenCalled();
  view.unmount();
});
