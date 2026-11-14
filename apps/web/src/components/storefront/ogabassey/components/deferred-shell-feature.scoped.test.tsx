import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeferredShellFeature } from './deferred-shell-feature';

function ScopedShellFeatureHarness() {
  const interactionTargetRef = useRef<HTMLElement | null>(null);

  return (
    <div>
      <button type="button">Outside trigger</button>
      <section aria-label="Scoped region" ref={interactionTargetRef}>
        <button type="button">Inside trigger</button>
        <DeferredShellFeature
          timeoutMs={0}
          activateOnIdle={false}
          interactionTargetRef={interactionTargetRef}
        >
          <div>Scoped child</div>
        </DeferredShellFeature>
      </section>
    </div>
  );
}

describe('DeferredShellFeature scoped activation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('scopes interaction activation to the interaction target element', async () => {
    render(<ScopedShellFeatureHarness />);

    expect(screen.queryByText('Scoped child')).not.toBeInTheDocument();

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Outside trigger' })
    );
    fireEvent.pointerDown(window);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('Scoped child')).not.toBeInTheDocument();

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Inside trigger' })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Scoped child')).toBeInTheDocument();
  });

  it('scopes keydown activation to the interaction target element', async () => {
    render(<ScopedShellFeatureHarness />);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Outside trigger' }), {
      key: 'Enter',
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('Scoped child')).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Inside trigger' }), {
      key: 'Enter',
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Scoped child')).toBeInTheDocument();
  });

  it('activates when focus enters the interaction target element', async () => {
    render(<ScopedShellFeatureHarness />);

    fireEvent.focusIn(screen.getByRole('button', { name: 'Outside trigger' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('Scoped child')).not.toBeInTheDocument();

    fireEvent.focusIn(screen.getByRole('button', { name: 'Inside trigger' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Scoped child')).toBeInTheDocument();
  });

  it('ignores touch pointerdown and synthesized focusin when ignoreTouchInteraction is enabled, then activates on mouse or keyboard', async () => {
    function TouchIgnoringHarness() {
      const interactionTargetRef = useRef<HTMLElement | null>(null);

      return (
        <section aria-label="Touch-ignoring region" ref={interactionTargetRef}>
          <button type="button">Inside trigger</button>
          <DeferredShellFeature
            timeoutMs={0}
            activateOnIdle={false}
            ignoreTouchInteraction
            interactionTargetRef={interactionTargetRef}
          >
            <div>Fine-pointer child</div>
          </DeferredShellFeature>
        </section>
      );
    }

    render(<TouchIgnoringHarness />);

    const trigger = screen.getByRole('button', { name: 'Inside trigger' });
    fireEvent.touchStart(trigger);
    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    fireEvent.focusIn(trigger);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('Fine-pointer child')).not.toBeInTheDocument();

    fireEvent.pointerDown(trigger, { pointerType: 'mouse' });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Fine-pointer child')).toBeInTheDocument();
  });
});
