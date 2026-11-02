import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { prepareFacebookPixel } from '@/lib/analytics/facebook-pixel-client';
import { usePreparedFacebookPixel } from './use-prepared-facebook-pixel';

vi.mock('@/lib/analytics/facebook-pixel-client', () => ({
  prepareFacebookPixel: vi.fn(),
}));
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
const consent = (analytics: boolean) =>
  JSON.stringify({
    necessary: true,
    functional: true,
    analytics,
    marketing: false,
  });
it('prepares only with analytics consent, rotates on revocation and releases on cleanup', () => {
  const releaseFirst = vi.fn();
  const releaseSecond = vi.fn();
  vi.mocked(prepareFacebookPixel)
    .mockReturnValueOnce(releaseFirst)
    .mockReturnValueOnce(releaseSecond);
  localStorage.setItem('baci-cookie-consent', consent(true));
  const view = renderHook(() =>
    usePreparedFacebookPixel('merchant-a', '111', '/products/phone')
  );
  expect(prepareFacebookPixel).toHaveBeenCalledWith('111', 'merchant-a');
  expect(view.result.current).toBe(0);
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(false));
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  expect(releaseFirst).toHaveBeenCalledOnce();
  expect(view.result.current).toBe(1);
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(true));
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  expect(prepareFacebookPixel).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(releaseSecond).toHaveBeenCalledOnce();
});
