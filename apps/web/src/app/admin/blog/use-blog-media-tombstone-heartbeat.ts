import { useEffect, useRef } from 'react';
import { BLOG_MEDIA_TOMBSTONE_HEARTBEAT_MS } from '@/app/api/admin/blog/upload/blog-media-tombstone-constants';

/**
 * Refresh the sweep lease on staged uploads while the draft that
 * references them stays open. Uploads stage as tombstones
 * immediately so abandoned sessions still sweep, but an editor open
 * past the grace window is not abandoned: each beat re-reads the
 * current unsaved paths and extends them. Empty beats send nothing,
 * failures stay silent for the next beat to retry, and unmount
 * clears the timer (the unmount flush then tombstones whatever the
 * saved payload does not keep).
 */
export function useBlogMediaTombstoneHeartbeat({
  getPaths,
  refresh,
  intervalMs = BLOG_MEDIA_TOMBSTONE_HEARTBEAT_MS,
}: {
  getPaths: () => string[];
  intervalMs?: number;
  refresh: (paths: string[]) => Promise<void>;
}) {
  const stateRef = useRef({ getPaths, refresh });
  stateRef.current = { getPaths, refresh };
  useEffect(() => {
    const beat = () => {
      const paths = stateRef.current.getPaths();
      if (paths.length === 0) return;
      // A failed beat retries on the next tick; swallow rejections so
      // a transient network blip never crashes the editor.
      void stateRef.current.refresh(paths).catch(() => undefined);
    };
    // A suspended tab runs no timers while the server-side sweep
    // continues, so beat on every lifecycle transition: hiding
    // extends the lease from the hide time (a phase-dependent beat
    // up to a full interval old would otherwise be the last one),
    // and resume beats immediately instead of waiting for the next
    // tick. A suspension past the grace window still expires — no
    // client code runs to renew it — and the save then fails loudly
    // on the swept references rather than silently.
    const onResume = () => {
      beat();
    };
    const timer = setInterval(beat, intervalMs);
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('pageshow', onResume);
    window.addEventListener('online', onResume);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('pageshow', onResume);
      window.removeEventListener('online', onResume);
    };
  }, [intervalMs]);
}
