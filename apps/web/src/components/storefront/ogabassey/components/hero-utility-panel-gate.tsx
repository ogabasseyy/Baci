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

// Maximum time the gate holds a loaded panel on the fallback while a press
// is in flight, awaiting its completion (click/up/cancel).
const PRESS_SETTLE_TIMEOUT_MS = 500;

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
 * First-tap replay: a completed click on a fallback option records its id
 * and the interactive panel replays it, opening that tab's modal on mount
 * — the shopper's first tap is honored instead of merely triggering the
 * load. Recording on click (not pointerdown) means cancelled scroll
 * gestures never replay. Because a cached-fast chunk can resolve between
 * pointerdown and click, the swap additionally waits out the in-flight
 * press (bounded by PRESS_SETTLE_TIMEOUT_MS): the fallback stays mounted
 * so the completing click still lands on the option it pressed. Capture
 * stays armed until the panel mounts, so a tap landing after a viewport/key
 * activation but before the chunk arrives still replays.
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
  // A press began (pointerdown) but has not completed (up/click/cancel).
  // While set, a loaded panel holds the fallback mounted so the completing
  // tap can still record its replay before the swap.
  const [pressHeld, setPressHeld] = useState(false);
  const [Panel, setPanel] =
    useState<HeroUtilityPanelModule['HeroUtilityPanel'] | null>(null);

  const isActive = isInViewport || hasInteracted;

  useEffect(() => {
    // Capture stays armed while the fallback is mounted — not just until
    // first activation, and crucially THROUGH a loaded panel held back by
    // an in-flight press: the completing click/up/cancel must still be
    // observed to record the replay and release the hold. Only the
    // committed swap unsubscribes.
    if (Panel !== null && !pressHeld) {
      return;
    }

    // pointerdown starts the load and marks the press in-flight, but
    // records nothing: scroll gestures also begin here.
    const handlePointerDown = () => {
      setHasInteracted(true);
      setPressHeld(true);
    };

    // A completed click is the replay signal: browsers suppress it for
    // cancelled scroll gestures, so only genuine taps record an option. A
    // chunk fast enough to mount before the click lands leaves the fallback
    // unmounted, and the tap then drives the interactive panel natively.
    const handleClick = (event: MouseEvent) => {
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
      setPressHeld(false);
    };

    // Any press completion without a click (release off-element, scroll
    // cancel) ends the hold with no replay. A completed click stands.
    const handlePointerUp = () => {
      setPressHeld(false);
    };

    const handlePointerCancel = () => {
      setPressHeld(false);
    };

    const handleKeyDown = () => {
      setHasInteracted(true);
    };

    window.addEventListener('pointerdown', handlePointerDown, {
      passive: true,
    });
    window.addEventListener('click', handleClick);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [Panel, pressHeld, ref]);

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

  // Bound the press hold: a press that never completes (lost capture
  // off-window) must not wedge the loaded panel on the fallback forever.
  // Tap completion latencies sit well under this bound.
  useEffect(() => {
    if (Panel === null || !pressHeld) {
      return;
    }
    const settleTimer = setTimeout(() => {
      setPressHeld(false);
    }, PRESS_SETTLE_TIMEOUT_MS);
    return () => {
      clearTimeout(settleTimer);
    };
  }, [Panel, pressHeld]);

  // Hold the fallback mounted while a press is in flight against a loaded
  // panel, so the completing click can still record its replay. Without
  // this, a cached-fast chunk mounts between pointerdown and click and the
  // first tap merely loads.
  const holdSwapForPress = Panel !== null && pressHeld;

  if (!isActive || !Panel || holdSwapForPress) {
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
