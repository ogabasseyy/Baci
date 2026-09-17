'use client';

import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { useViewportActivation } from '@/components/storefront/use-viewport-activation';
import { HeroUtilityPanelStatic } from './hero-utility-panel-static';

interface HeroUtilityPanelModule {
  HeroUtilityPanel: ComponentType;
}

interface HeroUtilityPanelGateProps {
  /**
   * Test seam (mirrors HomeProductGridGate.loadGridModule). Production loads
   * the interactive panel — its lucide icons and modal boundary — on demand.
   */
  loadPanelModule?: () => Promise<HeroUtilityPanelModule>;
  /**
   * Backstop activation delay when the panel never approaches the viewport.
   * Matches HomeProductGridGate so below-fold interactivity still arrives
   * for non-scrollers without competing with LCP.
   */
  timeoutMs?: number;
}

// Module-scope so the dynamic import() expression stays outside the component
// body (React Compiler cannot lower import expressions). Code splitting is
// unaffected: the chunk loads on first activation only.
const loadDefaultPanelModule = () => import('./hero-utility-panel');

/**
 * Viewport gate for the homepage utility panel. Server-renders (and keeps
 * until activation) the zero-JavaScript static twin — same copy, same boxes,
 * so the activation swap moves nothing — then loads the interactive panel
 * module on demand. Panel JS + its icon modules stay out of the initial
 * bundle.
 *
 * Activation fires on the first of: the panel approaching the viewport
 * (600px margin, so the swap lands before it is visible), the shopper's
 * first pointer/key interaction, or the backstop timeout. The pre-activation
 * fallback sits inside an `inert` boundary (React 19 boolean prop) because
 * its buttons are intentionally handler-free; `inert` has no visual effect,
 * so geometry is untouched. A failed module load keeps the static fallback
 * and logs once (same contract as HomeProductGridGate).
 */
export function HeroUtilityPanelGate({
  loadPanelModule = loadDefaultPanelModule,
  timeoutMs = 8000,
}: HeroUtilityPanelGateProps) {
  const { ref, isActive: isInViewport } =
    useViewportActivation<HTMLDivElement>({
      rootMargin: '600px 0px',
      timeoutMs,
    });
  const [hasInteracted, setHasInteracted] = useState(false);
  const [Panel, setPanel] =
    useState<HeroUtilityPanelModule['HeroUtilityPanel'] | null>(null);

  const isActive = isInViewport || hasInteracted;

  useEffect(() => {
    if (isActive) {
      return;
    }

    const handleInteraction = () => {
      setHasInteracted(true);
    };

    window.addEventListener('pointerdown', handleInteraction, {
      once: true,
      passive: true,
    });
    window.addEventListener('keydown', handleInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive || Panel) {
      return;
    }

    let cancelled = false;

    void loadPanelModule()
      .then((module) => {
        if (!cancelled) {
          setPanel(() => module.HeroUtilityPanel);
        }
      })
      .catch((error: unknown) => {
        console.error(
          '[HeroUtilityPanelGate] Failed to load utility panel module',
          error
        );
      });

    return () => {
      cancelled = true;
    };
  }, [Panel, isActive, loadPanelModule]);

  if (!isActive || !Panel) {
    return (
      <div ref={ref} inert data-ogabassey-hero-utility-gate="true">
        <HeroUtilityPanelStatic />
      </div>
    );
  }

  return <Panel />;
}
