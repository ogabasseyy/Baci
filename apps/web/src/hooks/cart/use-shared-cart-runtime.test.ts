import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

it('updates authority refs immediately when the merchant generation changes', () => {
  const { result, rerender } = renderHook(
    ({ merchantId, generation }) =>
      useSharedCartRuntime({
        merchantId,
        merchantSlug: merchantId,
        sessionGeneration: generation,
      }),
    { initialProps: { merchantId: 'a', generation: 1 } }
  );
  const ref = result.current.generationRef;
  rerender({ merchantId: 'b', generation: 2 });
  expect(result.current.generationRef).toBe(ref);
  expect(ref.current).toBe(2);
  expect(result.current.optionsRef.current).toEqual({
    merchantId: 'b',
    merchantSlug: 'b',
  });
});

it('keeps the old link epoch until the parent commits a new session generation', () => {
  window.localStorage.clear();
  const { result, rerender } = renderHook(
    ({ generation }) =>
      useSharedCartRuntime({
        merchantId: 'shop',
        merchantSlug: 'shop',
        sessionGeneration: generation,
      }),
    { initialProps: { generation: 1 } }
  );
  expect(result.current.cookieEpochRef.current?.value).toBe(null);
  window.localStorage.setItem(
    'baci-cart-authority-epoch:shop',
    'new-authority'
  );
  rerender({ generation: 1 });
  expect(result.current.cookieEpochRef.current?.value).toBe(null);
  rerender({ generation: 2 });
  expect(result.current.cookieEpochRef.current?.value).toBe('new-authority');
  window.localStorage.clear();
});
