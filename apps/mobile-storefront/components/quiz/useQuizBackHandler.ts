import { type RefObject, useLayoutEffect } from 'react';

export type QuizBackHandlerRef = RefObject<(() => void) | null>;

/** The mounted quiz surface owns header, gesture and hardware-back behavior. */
export function useQuizBackHandler(
  ref: QuizBackHandlerRef | undefined,
  handler: (() => void) | null
) {
  useLayoutEffect(() => {
    if (!ref || !handler) return;
    ref.current = handler;
    return () => {
      if (ref.current === handler) ref.current = null;
    };
  }, [ref, handler]);
}
