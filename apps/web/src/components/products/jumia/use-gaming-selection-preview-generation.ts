import { useLayoutEffect, useRef } from 'react';

export function useGamingSelectionPreviewGeneration(merchantId: string) {
  const current = useRef({ merchantId, generation: 0 });
  useLayoutEffect(() => {
    if (current.current.merchantId !== merchantId) {
      current.current = {
        merchantId,
        generation: current.current.generation + 1,
      };
    }
    return () => {
      current.current.generation += 1;
    };
  }, [merchantId]);
  return current;
}
