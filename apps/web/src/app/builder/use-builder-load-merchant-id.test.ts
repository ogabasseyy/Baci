// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useBuilderLoadMerchantId } from './use-builder-load-merchant-id';

const readyTarget = {
  authLoading: false,
  merchantLoading: false,
  userId: 'user-1',
};

describe('useBuilderLoadMerchantId', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/builder');
  });

  it('removes an AI draft intended for the previous merchant before returning the next load target', async () => {
    window.history.replaceState({}, '', '/builder?aiDraftJobId=job-for-a');
    const { result, rerender } = renderHook(
      ({ merchantId }) =>
        useBuilderLoadMerchantId({ ...readyTarget, merchantId }),
      { initialProps: { merchantId: 'merchant-a' } }
    );

    await waitFor(() => {
      expect(result.current).toBe('merchant-a');
    });

    rerender({ merchantId: 'merchant-b' });

    await waitFor(() => {
      expect(result.current).toBe('merchant-b');
    });
    expect(window.location.search).toBe('');
  });
});
