// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBlogMerchantSession } from './use-blog-merchant-session';

describe('useBlogMerchantSession', () => {
  it('invalidates the captured session after a merchant change or unmount', () => {
    const { result, rerender, unmount } = renderHook(
      ({ merchantId }) => useBlogMerchantSession(merchantId),
      { initialProps: { merchantId: 'merchant-a' } }
    );
    const merchantASession = result.current.current;

    rerender({ merchantId: 'merchant-b' });
    const merchantBSession = result.current.current;
    expect(merchantBSession).not.toBe(merchantASession);

    const sessionRef = result.current;
    unmount();

    expect(sessionRef.current).not.toBe(merchantBSession);
  });
});
