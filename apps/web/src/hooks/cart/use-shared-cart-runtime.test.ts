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
