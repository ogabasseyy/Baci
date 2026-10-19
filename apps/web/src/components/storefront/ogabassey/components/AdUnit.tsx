// Migrated from temp-source/components/AdUnit.tsx
'use client';

import type React from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runWhenPageActivated } from '@/lib/dom/run-when-page-activated';
import { AD_CONFIG } from '../config/ads';
import { AdSlotShell } from './ad-slot-shell';
import {
  registerPubAdsSlotRenderListener,
  type GoogleSlotRenderEndedEvent,
} from './ad-unit-gpt-listeners';
import {
  ensureGoogleAdManagerBoot,
  ensureGoogleTag,
} from './google-ad-bootstrap';

// GPT teardown must run before React removes the slot element, but this client
// component is also pre-rendered by Next.js. Keep the ordering guarantee in
// the browser without making server rendering call useLayoutEffect.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface AdUnitProps {
  placementKey: keyof typeof AD_CONFIG;
  className?: string;
  refreshKey?: string | number;
  isActive?: boolean;
  loadStrategy?: 'viewport' | 'immediate';
  bootDelayMs?: number;
}

// TODO: REPLACE WITH YOUR ACTUAL GOOGLE AD MANAGER NETWORK CODE
const NETWORK_CODE = '/23331099951'; // Updated from screenshot

// Track defined slots globally to prevent duplicates in React StrictMode
const definedSlots = new Set<string>();

export const AdUnit: React.FC<AdUnitProps> = ({
  placementKey,
  className = '',
  refreshKey,
  isActive = true,
  loadStrategy = 'viewport',
  bootDelayMs = 0,
}) => {
  const config = AD_CONFIG[placementKey];
  const configId = config?.id;
  const containerRef = useRef<HTMLDivElement>(null);
  const adRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<googletag.Slot | null>(null);
  const isActiveRef = useRef(isActive);
  const listenerCleanupsRef = useRef<Array<() => void>>([]);
  const slotLifecycleRef = useRef(0);
  const slotRestoreNeededRef = useRef(false);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [shouldLoadSlot, setShouldLoadSlot] = useState(
    loadStrategy === 'immediate'
  );
  const [hasBootDelayElapsed, setHasBootDelayElapsed] = useState(
    bootDelayMs <= 0
  );
  const [slotRestoreNonce, setSlotRestoreNonce] = useState(0);

  // Reset slot/boot state during render when the placement or strategy props
  // change (render-phase prev-compare instead of a setState-in-effect).
  const [prevConfigId, setPrevConfigId] = useState(configId);
  const [prevLoadStrategy, setPrevLoadStrategy] = useState(loadStrategy);
  const [prevBootDelayMs, setPrevBootDelayMs] = useState(bootDelayMs);
  const configChanged = prevConfigId !== configId;
  if (configChanged) {
    setPrevConfigId(configId);
  }
  if (configChanged || prevLoadStrategy !== loadStrategy) {
    setPrevLoadStrategy(loadStrategy);
    setShouldLoadSlot(loadStrategy === 'immediate');
    setIsAdLoaded(false);
  }
  if (configChanged || prevBootDelayMs !== bootDelayMs) {
    setPrevBootDelayMs(bootDelayMs);
    setHasBootDelayElapsed(bootDelayMs <= 0);
  }

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    if (bootDelayMs <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setHasBootDelayElapsed(true);
    }, bootDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [bootDelayMs, configId]);

  useEffect(() => {
    // `shouldLoadSlot` is already true whenever loadStrategy is 'immediate'
    // (initializer + render-phase reset above), so no setState is needed here.
    if (!config || loadStrategy === 'immediate' || !isActive || shouldLoadSlot) {
      return;
    }

    const target = containerRef.current;

    if (!target || typeof IntersectionObserver === 'undefined') {
      setShouldLoadSlot(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) => entry.isIntersecting || entry.intersectionRatio > 0
          )
        ) {
          setShouldLoadSlot(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' }
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [config, isActive, loadStrategy, shouldLoadSlot]);

  useEffect(() => {
    if (!config || !isActive || !shouldLoadSlot || !hasBootDelayElapsed) return;

    const { id, width, height, mobileWidth, mobileHeight } = config;
    const slotPath = `${NETWORK_CODE}/${config.name.replace(/\s+/g, '_')}`; // Construct ad unit path
    const lifecycle = slotLifecycleRef.current;
    let isDisposed = false;

    // Skip if this slot is already defined (React StrictMode double-render protection)
    if (definedSlots.has(id)) {
      return;
    }

    const cancelActivationGate = runWhenPageActivated(() => {
      void ensureGoogleAdManagerBoot()
        .then(() => {
          if (
            isDisposed ||
            lifecycle !== slotLifecycleRef.current ||
            !isActiveRef.current ||
            definedSlots.has(id)
          ) {
            return;
          }

          const googletag = ensureGoogleTag();

          googletag.cmd.push(() => {
            if (
              isDisposed ||
              lifecycle !== slotLifecycleRef.current ||
              !isActiveRef.current ||
              definedSlots.has(id)
            ) {
              return;
            }

            // Define the slot
            // We implement basic size mapping for responsiveness if mobile dims exist
            let slot;

            if (mobileWidth && mobileHeight) {
              const mapping = googletag.sizeMapping()
                .addSize([768, 0], [width, height]) // Desktop
                .addSize([0, 0], [mobileWidth, mobileHeight]) // Mobile
                .build();

              slot = googletag
                .defineSlot(slotPath, [width, height], id)
                ?.defineSizeMapping(mapping)
                .addService(googletag.pubads());
            } else {
              slot = googletag
                .defineSlot(slotPath, [width, height], id)
                ?.addService(googletag.pubads());
            }

            if (slot) {
              // Track this slot as defined
              definedSlots.add(id);
              slotRef.current = slot;

              googletag.display(id);

              // Listen for render events to hide placeholder if needed
              const slotRenderEndedHandler = (event: unknown) => {
                const renderEvent = event as GoogleSlotRenderEndedEvent;
                if (renderEvent.slot === slot) {
                  setIsAdLoaded(!renderEvent.isEmpty);
                }
              };
              listenerCleanupsRef.current.push(
                registerPubAdsSlotRenderListener(
                  googletag.pubads(),
                  slotRenderEndedHandler
                )
              );
            }
          });
        })
        .catch(() => {
          setIsAdLoaded(false);
        });
    });

    return () => {
      isDisposed = true;
      cancelActivationGate();
    };
  }, [config, hasBootDelayElapsed, isActive, shouldLoadSlot, slotRestoreNonce]);

  useIsomorphicLayoutEffect(() => {
    if (!config) return;

    if (slotRestoreNeededRef.current) {
      slotRestoreNeededRef.current = false;
      setIsAdLoaded(false);
      setSlotRestoreNonce((nonce) => nonce + 1);
    }

    const slotId = config.id;

    return () => {
      slotLifecycleRef.current += 1;
      slotRestoreNeededRef.current = true;
      // Cleanup only on unmount or placement changes. Carousel visibility changes
      // should keep an already loaded GPT slot mounted.
      const slotToDestroy = slotRef.current;
      if (slotToDestroy) {
        const googletag = ensureGoogleTag();

        googletag.cmd.push(() => {
          for (const cleanup of listenerCleanupsRef.current) {
            cleanup();
          }
          listenerCleanupsRef.current = [];
          googletag.destroySlots([slotToDestroy]);
          definedSlots.delete(slotId);
          slotRef.current = null;
        });
      }
    };
  }, [config]);

  // Effect to handle manual refresh triggers
  useEffect(() => {
    if (!config || !isActive || !slotRef.current || !window.googletag?.pubads) {
      return;
    }

    // Check if we have a refresh trigger and a valid slot
    const slot = slotRef.current;

    if (refreshKey && slot) {
      window.googletag.cmd.push(() => {
        window.googletag.pubads().refresh([slot]);
      });
    }
  }, [refreshKey, config, isActive]);

  if (!config) return null;

  // The reserved box is rendered by the shared AdSlotShell so the loaded ad and
  // the deferred fallback occupy an identical, height-locked box -> no CLS on
  // either the fallback->ad swap or the ad fill. The live GPT slot is passed as
  // children; `containerRef` (on the box) drives viewport activation.
  return (
    <AdSlotShell
      boxRef={containerRef}
      height={config.height}
      mobileHeight={config.mobileHeight}
      mobileWidth={config.mobileWidth}
      name={config.name}
      outerClassName={className}
      showPlaceholder={!isAdLoaded}
      width={config.width}
    >
      {/* THE ACTUAL GOOGLE AD SLOT */}
      <div className="z-10" id={config.id} ref={adRef} />
    </AdSlotShell>
  );
};
