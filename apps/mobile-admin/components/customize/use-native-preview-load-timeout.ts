import { type RefObject, useEffect } from 'react';
import {
  type NativePreviewInput,
  type NativePreviewSession,
  sessionIsCurrent,
} from './native-preview-session-context';

export function useNativePreviewLoadTimeout(
  session: NativePreviewSession | null,
  loaded: boolean,
  failed: boolean,
  active: RefObject<NativePreviewSession | null>,
  input: RefObject<NativePreviewInput>,
  onTimeout: (error: 'load') => void
) {
  useEffect(() => {
    if (!session || loaded || failed) return;
    const timer = setTimeout(() => {
      if (
        sessionIsCurrent(
          active.current,
          input.current,
          session.instanceId,
          session.nonce
        )
      ) {
        active.current = null;
        onTimeout('load');
      }
    }, 10_000);
    return () => clearTimeout(timer);
  }, [session, loaded, failed, active, input, onTimeout]);
}
