'use client';

import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { useViewportActivation } from '@/components/storefront/use-viewport-activation';
import type {
  HeroUtilityPanelProps,
  UtilityTab,
} from './hero-utility-panel';
import { HeroUtilityPanelStatic } from './hero-utility-panel-static';

interface HeroUtilityPanelModule {
  HeroUtilityPanel: ComponentType<HeroUtilityPanelProps>;
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

const UTILITY_TABS = ['airtime', 'data', 'tv', 'power', 'betting'] as const;

function isUtilityTab(value: string | null): value is UtilityTab {
  return (
    value !== null && (UTILITY_TABS as readonly string[]).includes(value)
  );
}

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
 * fallback is deliberately NOT `inert`: inert subtrees are excluded from hit
 * testing (verified in Chromium: a tap inside retargets `pointerdown` to the
 * nearest non-inert ancestor), which would make first-tap replay
 * unobservable. Instead the fallback is `aria-hidden` with unfocusable
 * (`tabIndex={-1}`) handler-free buttons — same practical outcome (no tab
 * stops, hidden from assistive tech, taps do nothing until the swap) while
 * keeping the tapped option's `data-utility-option` id readable from the
 * activating pointerdown. A failed module load keeps the static fallback
 * and logs once (same contract as HomeProductGridGate).
 *
 * First-tap replay: the gate records the tapped option id and replays it
 * into the interactive panel, which opens that tab's modal on mount — the
 * shopper's first tap is honored instead of merely triggering the load.
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
  const [pendingUtilityTab, setPendingUtilityTab] =
    useState<UtilityTab | null>(null);
  const [Panel, setPanel] =
    useState<HeroUtilityPanelModule['HeroUtilityPanel'] | null>(null);

  const isActive = isInViewport || hasInteracted;

  useEffect(() => {
    if (isActive) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      // The activating tap may land on a fallback option: record it so the
      // interactive panel can replay the action on mount. Taps outside the
      // fallback (or on non-option chrome) activate without a replay.
      const target = event.target;
      if (target instanceof Element && ref.current?.contains(target)) {
        const optionId =
          target
            .closest('[data-utility-option]')
            ?.getAttribute('data-utility-option') ?? null;
        if (isUtilityTab(optionId)) {
          setPendingUtilityTab(optionId);
        }
      }
      setHasInteracted(true);
    };

    const handleKeyDown = () => {
      setHasInteracted(true);
    };

    window.addEventListener('pointerdown', handlePointerDown, {
      once: true,
      passive: true,
    });
    window.addEventListener('keydown', handleKeyDown, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, ref]);

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
      <div
        ref={ref}
        aria-hidden="true"
        data-ogabassey-hero-utility-gate="true"
      >
        <HeroUtilityPanelStatic />
      </div>
    );
  }

  return <Panel pendingUtilityTab={pendingUtilityTab} />;
}
