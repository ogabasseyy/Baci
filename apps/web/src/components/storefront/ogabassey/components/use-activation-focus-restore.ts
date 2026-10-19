import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

type PendingFocusTarget =
  | { kind: 'anchor'; value: string; element: HTMLElement }
  | { kind: 'button'; value: string; element: HTMLElement };

function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function buttonLabel(button: HTMLElement): string {
  return (button.getAttribute('aria-label') ?? button.textContent ?? '').trim();
}

/**
 * Preserves keyboard focus across the static→interactive product-grid swap.
 *
 * Grid-scoped activation means a keyboard user tabbing INTO the still-static
 * grid is what triggers the interactive-module swap — and the swap changes the
 * root element type, so React remounts the subtree and unmounts the focused
 * node, dropping focus to <body>. Call `capture()` synchronously before the
 * activating state update; the hook restores focus to the equivalent element
 * (same link href, or same button label) once `activated` commits, unless the
 * user moved focus elsewhere while the transition was pending.
 */
export function useActivationFocusRestore(
  containerRef: RefObject<HTMLElement | null>,
  activated: boolean
): { capture: () => void } {
  const pendingRef = useRef<PendingFocusTarget | null>(null);
  const cleanupFocusTrackingRef = useRef<(() => void) | null>(null);

  const registerFocusTracking = () => {
    const handleFocusIn = (event: FocusEvent) => {
      if (
        pendingRef.current &&
        event.target instanceof Node &&
        !pendingRef.current.element.contains(event.target)
      ) {
        pendingRef.current = null;
        cleanupFocusTrackingRef.current?.();
      }
    };

    document.addEventListener('focusin', handleFocusIn, true);
    cleanupFocusTrackingRef.current = () => {
      document.removeEventListener('focusin', handleFocusIn, true);
      cleanupFocusTrackingRef.current = null;
    };
  };

  const capture = () => {
    cleanupFocusTrackingRef.current?.();
    pendingRef.current = null;

    const container = containerRef.current;
    const active = document.activeElement;
    if (
      !container ||
      !(active instanceof HTMLElement) ||
      !container.contains(active)
    ) {
      return;
    }

    const anchor = active.closest('a[href]');
    if (anchor instanceof HTMLElement) {
      const href = anchor.getAttribute('href');
      if (href) {
        pendingRef.current = { kind: 'anchor', value: href, element: anchor };
        registerFocusTracking();
        return;
      }
    }

    const button = active.closest('button');
    if (button instanceof HTMLElement) {
      pendingRef.current = {
        kind: 'button',
        value: buttonLabel(button),
        element: button,
      };
      registerFocusTracking();
    }
  };

  useEffect(() => {
    if (!activated || !pendingRef.current) {
      return;
    }

    cleanupFocusTrackingRef.current?.();
    const pending = pendingRef.current;
    pendingRef.current = null;
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const currentActive = document.activeElement;
    if (
      currentActive instanceof HTMLElement &&
      currentActive !== document.body &&
      currentActive !== document.documentElement &&
      !pending.element.contains(currentActive)
    ) {
      return;
    }

    let target: HTMLElement | null = null;
    if (pending.kind === 'anchor') {
      target = container.querySelector<HTMLElement>(
        `a[href="${escapeAttributeValue(pending.value)}"]`
      );
    } else {
      target =
        Array.from(container.querySelectorAll('button')).find(
          (button) => buttonLabel(button) === pending.value
        ) ?? null;
    }

    target?.focus();
  }, [activated, containerRef]);

  useEffect(() => {
    return () => {
      cleanupFocusTrackingRef.current?.();
    };
  }, []);

  return { capture };
}
