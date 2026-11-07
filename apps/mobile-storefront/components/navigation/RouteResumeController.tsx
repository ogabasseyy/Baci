import {
  router,
  useGlobalSearchParams,
  usePathname,
  useRootNavigationState,
} from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  buildPersistableResumeHref,
  buildResumeHref,
  clearRouteResumeState,
  getLastResumableHref,
  getLastResumableNavigationKey,
  hasControllerUnmountedSinceCapture,
  hydrateRouteResumeState,
  isAuthPath,
  isHomePath,
  markControllerUnmountedSinceCapture,
  type RouteSearchParams,
  setLastResumableHref,
} from './route-resume-state';

export {
  resetRouteResumeForTest,
  resetRouteResumeMemoryForTest,
} from './route-resume-state';

interface RouteResumeControllerProps {
  shouldResume: boolean;
}

export function RouteResumeController({
  shouldResume,
}: RouteResumeControllerProps) {
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams() as RouteSearchParams;
  const navigationState = useRootNavigationState();
  const navigationKey = navigationState?.key ?? null;
  const hasAttemptedResumeRef = useRef(false);
  const currentResumeHref = buildResumeHref(pathname, searchParams);
  const currentPersistableResumeHref = buildPersistableResumeHref(
    pathname,
    searchParams
  );
  const [hasHydratedPersistedResume, setHasHydratedPersistedResume] =
    useState(false);

  useEffect(() => {
    let isActive = true;

    hydrateRouteResumeState()
      .catch((error) => {
        console.warn(
          '[RouteResumeController] Failed to hydrate route resume state',
          error
        );
      })
      .finally(() => {
        if (isActive) {
          setHasHydratedPersistedResume(true);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (getLastResumableHref()) {
        markControllerUnmountedSinceCapture();
      }
    };
  }, []);

  useEffect(() => {
    if (
      !shouldResume ||
      hasAttemptedResumeRef.current ||
      (!hasHydratedPersistedResume && !getLastResumableHref()) ||
      !navigationKey
    ) {
      return;
    }

    const resumeHref = getLastResumableHref();
    const savedNavigationKey = getLastResumableNavigationKey();
    const shouldResumeFromHome =
      isHomePath(pathname) &&
      resumeHref &&
      (hasControllerUnmountedSinceCapture() ||
        (savedNavigationKey !== null && savedNavigationKey !== navigationKey));

    if (shouldResumeFromHome) {
      hasAttemptedResumeRef.current = true;
      try {
        console.info('[StartupRoute]', 'navigation_resume_requested');
        router.replace(resumeHref);
      } catch (error) {
        console.warn(
          '[RouteResumeController] Failed to restore the previous commerce route',
          error
        );
      }
    }
  }, [hasHydratedPersistedResume, navigationKey, pathname, shouldResume]);

  useEffect(() => {
    let isActive = true;

    const syncRouteResumeState = async () => {
      if (currentResumeHref) {
        await setLastResumableHref(
          currentResumeHref,
          navigationKey,
          currentPersistableResumeHref
        );
        if (isActive) {
          hasAttemptedResumeRef.current = false;
        }
        return;
      }

      if (
        isHomePath(pathname) &&
        getLastResumableHref() &&
        getLastResumableNavigationKey() === navigationKey &&
        !hasControllerUnmountedSinceCapture()
      ) {
        await clearRouteResumeState();
        return;
      }

      if (!hasHydratedPersistedResume) {
        return;
      }

      if (isAuthPath(pathname)) {
        return;
      }

      // Clear saved resume state once it is no longer usable, while preserving it
      // through auth routes used by checkout/payment sign-in flows.
      if (!shouldResume || hasAttemptedResumeRef.current) {
        await clearRouteResumeState();
        return;
      }

      if (!navigationKey) {
        return;
      }

      if (pathname) {
        await clearRouteResumeState();
      }
    };

    void syncRouteResumeState().catch((error) => {
      console.warn(
        '[RouteResumeController] Failed to sync route resume state',
        error
      );
    });

    return () => {
      isActive = false;
    };
  }, [
    currentResumeHref,
    currentPersistableResumeHref,
    hasHydratedPersistedResume,
    navigationKey,
    pathname,
    shouldResume,
  ]);

  return null;
}
