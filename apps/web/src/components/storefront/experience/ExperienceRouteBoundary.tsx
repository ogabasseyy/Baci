'use client';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  use,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ExperienceBoundaryData } from '@/lib/experience/storefront-runtime';
import styles from './ExperienceRouteBoundary.module.css';
import { ExperienceShellContext } from './experience-shell-context';
export function ExperienceRouteBoundary({
  data,
  fallback,
}: {
  data: ExperienceBoundaryData;
  fallback: ReactNode;
}) {
  const router = useRouter();
  const controller = use(ExperienceShellContext);
  const [lease] = useState(() => crypto.randomUUID());
  useLayoutEffect(() => {
    controller?.activate(lease, data);
    return () => controller?.release(lease);
  }, [controller, lease, data]);
  const state = useSyncExternalStore(
    controller?.subscribe ??
      (() => () => {
        /* No provider subscription exists in the native-only fallback. */
      }),
    controller?.getSnapshot ?? (() => null),
    () => null
  );
  const hidden = !!state?.active && state.ready;
  const pending = !!controller && (!state || (state.active && !state.ready));
  if (state && !state.active && !state.fallbackFresh)
    return (
      <section role="alert">
        <p>
          The current storefront could not be verified. Refresh to continue
          safely.
        </p>
        <button type="button" onClick={() => router.refresh()}>
          Refresh storefront
        </button>
      </section>
    );
  return (
    <div
      hidden={hidden}
      inert={hidden}
      aria-hidden={hidden || undefined}
      data-experience-semantic-fallback
      data-experience-pending={pending || undefined}
    >
      {pending && (
        <div className={styles.loading} role="status" aria-live="polite">
          Loading storefront…
        </div>
      )}
      <div className={styles.fallback}>{fallback}</div>
    </div>
  );
}
