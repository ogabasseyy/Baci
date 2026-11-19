import { useLayoutEffect, useRef } from 'react';

type PreviewGeneration = {
  merchantId: string;
  generation: number;
  requestController: AbortController;
};

export function useGamingSelectionPreviewGeneration(merchantId: string) {
  const current = useRef<PreviewGeneration>({
    merchantId,
    generation: 0,
    requestController: new AbortController(),
  });
  useLayoutEffect(() => {
    if (current.current.merchantId !== merchantId) {
      current.current = {
        merchantId,
        generation: current.current.generation + 1,
        requestController: new AbortController(),
      };
    } else if (current.current.requestController.signal.aborted) {
      current.current = {
        ...current.current,
        generation: current.current.generation + 1,
        requestController: new AbortController(),
      };
    }
    const activeGeneration = current.current;
    return () => {
      activeGeneration.requestController.abort();
      if (current.current === activeGeneration) {
        current.current = {
          ...activeGeneration,
          generation: activeGeneration.generation + 1,
        };
      }
    };
  }, [merchantId]);
  return current;
}
