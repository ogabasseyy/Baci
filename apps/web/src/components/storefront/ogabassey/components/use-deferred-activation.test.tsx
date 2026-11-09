import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeferredActivation } from './use-deferred-activation';

function HookHarness({
  ignoreTouchInteraction = false,
}: {
  ignoreTouchInteraction?: boolean;
}) {
  const targetRef = useRef<HTMLButtonElement | null>(null);
  const isActivated = useDeferredActivation({
    activateOnIdle: false,
    ignoreTouchInteraction,
    interactionTargetRef: targetRef,
    timeoutMs: 0,
  });

  return (
    <button ref={targetRef} type="button">
      {isActivated ? 'Activated' : 'Idle'}
    </button>
  );
}

describe('useDeferredActivation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('ignores touch tap and synthesized focusin when ignoreTouchInteraction is true, then activates on later keyboard focus', async () => {
    render(<HookHarness ignoreTouchInteraction />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Idle');

    fireEvent.touchStart(button);
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    fireEvent.focusIn(button);

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(button).toHaveTextContent('Idle');

    fireEvent.focusIn(button);

    await act(async () => {
      await Promise.resolve();
    });

    expect(button).toHaveTextContent('Activated');
  });
});
