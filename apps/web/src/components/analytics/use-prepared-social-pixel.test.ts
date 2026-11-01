import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { usePreparedSocialPixel } from './use-prepared-social-pixel';

it('releases the prepared owner when marketing consent is withdrawn', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  const view = renderHook(() =>
    usePreparedSocialPixel('tiktok', 'merchant', 'TT123')
  );
  expect(socialPixelContext.get('tiktok')?.id).toBe('TT123');
  act(() => {
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        functional: true,
        analytics: true,
        marketing: false,
      })
    );
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  expect(socialPixelContext.get('tiktok')).toBeUndefined();
  view.unmount();
  localStorage.clear();
});
