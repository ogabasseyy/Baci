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
    const timer = setInterval(beat, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
}
