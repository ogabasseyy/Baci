'use client';

import type { ComponentType, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AD_CONFIG } from '../config/ads';
import { AdSlotShell } from './ad-slot-shell';
import type { AdUnitProps } from './AdUnit';
import { useDeferredActivation } from './deferred-shell-feature';

interface DeferredAdUnitModule {
  AdUnit: ComponentType<AdUnitProps>;
}

export interface DeferredAdUnitProps extends AdUnitProps {
  activateOnIdle?: boolean;
  activateOnInteraction?: boolean;
  activateOnScroll?: boolean;
  deferInteractionActivationUntilNextPaint?: boolean;
  enabled?: boolean;
  fallback?: ReactNode;
  loadAdUnitModule?: () => Promise<DeferredAdUnitModule>;
  timeoutMs?: number;
}

const loadDefaultAdUnitModule = () => import('./AdUnit');

export function DeferredAdUnit({
  activateOnIdle = false,
  activateOnInteraction = false,
  activateOnScroll = false,
  deferInteractionActivationUntilNextPaint = false,
  enabled = true,
  fallback,
  loadAdUnitModule = loadDefaultAdUnitModule,
  timeoutMs = 1,
  ...adUnitProps
}: DeferredAdUnitProps) {
  const [AdUnitComponent, setAdUnitComponent] =
    useState<ComponentType<AdUnitProps> | null>(null);
  const isActivated = useDeferredActivation({
    activateOnIdle,
    activateOnInteraction,
    activateOnScroll,
    deferInteractionActivationUntilNextPaint,
    enabled,
    timeoutMs,
  });

  // Reserve the slot with the SAME shell the loaded AdUnit uses, sized from the
  // placement config, so the activation swap never changes the box height (no
  // CLS). Callers may still override with an explicit `fallback`.
  const placementConfig = AD_CONFIG[adUnitProps.placementKey];
  const resolvedFallback =
    fallback !== undefined ? (
      fallback
    ) : placementConfig ? (
      <AdSlotShell
        ariaHidden
        height={placementConfig.height}
        mobileHeight={placementConfig.mobileHeight}
        mobileWidth={placementConfig.mobileWidth}
        name={placementConfig.name}
        outerClassName={adUnitProps.className ?? ''}
        width={placementConfig.width}
      />
    ) : null;

  useEffect(() => {
    if (!isActivated || AdUnitComponent) {
      return;
    }

    let cancelled = false;

    void loadAdUnitModule()
      .then((module) => {
        if (!cancelled) {
          setAdUnitComponent(() => module.AdUnit);
        }
      })
      .catch((error: unknown) => {
        console.error('[DeferredAdUnit] Failed to load AdUnit module', error);
        if (!cancelled) {
          setAdUnitComponent(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [AdUnitComponent, isActivated, loadAdUnitModule]);

  if (!isActivated || !AdUnitComponent) {
    return resolvedFallback;
  }

  return <AdUnitComponent {...adUnitProps} />;
}
