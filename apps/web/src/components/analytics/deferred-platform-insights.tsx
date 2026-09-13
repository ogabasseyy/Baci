'use client';

import { type ComponentType, useEffect, useState } from 'react';
import { isLocalhostIdentifier } from '@/lib/storefront-host';

const DEFAULT_PLATFORM_INSIGHTS_TIMEOUT_MS = 15000;

interface DeferredPlatformInsightsProps {
  timeoutMs?: number;
  loadModules?: () => Promise<InsightModules>;
}

interface InsightModules {
  Analytics?: ComponentType;
  SpeedInsights?: ComponentType;
}

async function loadDefaultInsightModules(): Promise<InsightModules> {
  const [analyticsModule, speedInsightsModule] = await Promise.all([
    import('@vercel/analytics/next'),
    import('@vercel/speed-insights/next'),
  ]);

  return {
    Analytics: analyticsModule.Analytics,
    SpeedInsights: speedInsightsModule.SpeedInsights,
  };
}

export function DeferredPlatformInsights({
  timeoutMs = DEFAULT_PLATFORM_INSIGHTS_TIMEOUT_MS,
  loadModules,
}: DeferredPlatformInsightsProps) {
  const [isActivated, setIsActivated] = useState(false);
  const [modules, setModules] = useState<InsightModules>({});

  useEffect(() => {
    if (isActivated || isLocalhostIdentifier(window.location.hostname)) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    let idleCallbackId: number | undefined;
    let loadListenerAttached = false;

    const activate = () => {
      if (!cancelled) {
        setIsActivated(true);
      }
    };

    const scheduleIdleActivation = () => {
      if (cancelled || idleCallbackId !== undefined) {
        return;
      }

      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(activate, {
          timeout: timeoutMs || 1000,
        });
        return;
      }

      idleCallbackId = window.setTimeout(activate, 0);
    };

    const handleWindowLoad = () => {
      window.removeEventListener('load', handleWindowLoad);
      loadListenerAttached = false;
      scheduleIdleActivation();
    };

    timeoutId =
      timeoutMs > 0 ? window.setTimeout(activate, timeoutMs) : undefined;

    if (document.readyState !== 'complete') {
      loadListenerAttached = true;
      window.addEventListener('load', handleWindowLoad, { once: true });
    }

    return () => {
      cancelled = true;

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }

      if (idleCallbackId !== undefined) {
        if (typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleCallbackId);
        } else {
          window.clearTimeout(idleCallbackId);
        }
      }

      if (loadListenerAttached) {
        window.removeEventListener('load', handleWindowLoad);
      }
    };
  }, [isActivated, timeoutMs]);

  useEffect(() => {
    if (!isActivated) {
      return;
    }

    let cancelled = false;

    const loadInsightModules = loadModules ?? loadDefaultInsightModules;

    // These modules are optional observability enhancements. A failed dynamic
    // import must stay fail-open; without a terminal catch, Safari reports its
    // generic `TypeError: Load failed` as an unhandled rejection on every route.
    void loadInsightModules()
      .then((loadedModules) => {
        if (!cancelled) {
          setModules(loadedModules);
        }
      })
      .catch(() => {
        // Keep the core storefront usable when either optional module cannot
        // be fetched (offline, blocked, or a transient chunk failure).
      });

    return () => {
      cancelled = true;
    };
  }, [isActivated, loadModules]);

  if (!isActivated) {
    return null;
  }

  const Analytics = modules.Analytics;
  const SpeedInsights = modules.SpeedInsights;

  return (
    <>
      {Analytics ? <Analytics /> : null}
      {SpeedInsights ? <SpeedInsights /> : null}
    </>
  );
}

export { DEFAULT_PLATFORM_INSIGHTS_TIMEOUT_MS };
