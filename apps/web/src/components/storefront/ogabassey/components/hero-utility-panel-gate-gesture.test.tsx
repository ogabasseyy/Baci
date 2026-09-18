import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroUtilityPanelGate } from './hero-utility-panel-gate';
import {
  echoPanelLoader,
  setupGateHarness,
  teardownGateHarness,
} from './hero-utility-panel-gate-test-setup';

const mocks = vi.hoisted(() => ({
  // The gate defers to the post-LCP signal; resolve immediately so timing
  // stays deterministic under jsdom, which never emits LCP entries.
  waitForLcpWindowEnd: vi.fn(async () => undefined),
}));

vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: mocks.waitForLcpWindowEnd,
}));

describe('HeroUtilityPanelGate tap gestures', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = setupGateHarness();
  });

  afterEach(() => {
    teardownGateHarness(consoleErrorSpy);
  });

  it('replays a completed click on a fallback option', async () => {
    const echoLoader = echoPanelLoader();
    render(
      <HeroUtilityPanelGate
        loadPanelModule={echoLoader as never}
        timeoutMs={1000}
      />
    );

    const dataButton = screen.getAllByText('Data')[0]?.closest('button');
    fireEvent.click(dataButton!);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(echoLoader).toHaveBeenCalledOnce();
    expect(screen.getByTestId('interactive-utility-panel')).toHaveAttribute(
      'data-pending',
      'data'
    );
  });

  it('replays a fast-load tap that completes after the chunk resolves', async () => {
    // The cached-fast race: the press starts the load, the chunk resolves
    // while the press is still in flight, but the swap waits — so the
    // completing click still lands on the pressed option and replays it.
    const echoLoader = echoPanelLoader();
    render(
      <HeroUtilityPanelGate
        loadPanelModule={echoLoader as never}
        timeoutMs={1000}
      />
    );

    const dataButton = screen.getAllByText('Data')[0]?.closest('button');
    await act(async () => {
      fireEvent.pointerDown(dataButton!);
      await Promise.resolve();
    });
    // Loaded, but the in-flight press holds the fallback mounted.
    expect(echoLoader).toHaveBeenCalledOnce();
    expect(
      screen.queryByTestId('interactive-utility-panel')
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(dataButton!);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('interactive-utility-panel')).toHaveAttribute(
      'data-pending',
      'data'
    );
  });

  it('never replays a press cancelled mid-gesture', async () => {
    // pointerdown starts the load but records nothing; the swipe cancels
    // before completion, so the panel mounts with no replay.
    const echoLoader = echoPanelLoader();
    render(
      <HeroUtilityPanelGate
        loadPanelModule={echoLoader as never}
        timeoutMs={1000}
      />
    );

    const dataButton = screen.getAllByText('Data')[0]?.closest('button');
    await act(async () => {
      fireEvent.pointerDown(dataButton!);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.pointerCancel(window);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(echoLoader).toHaveBeenCalledOnce();
    expect(screen.getByTestId('interactive-utility-panel')).toHaveAttribute(
      'data-pending',
      'none'
    );
  });

  it('preserves a long press that completes after the settle bound', async () => {
    // A press held past 500ms with the pointer still down is a genuine
    // long press, not a stuck one: the hold must extend until release, or
    // the swap unmounts the pressed button and the completing click (which
    // targets the removed node) never fires — losing the first action.
    const echoLoader = echoPanelLoader();
    render(
      <HeroUtilityPanelGate
        loadPanelModule={echoLoader as never}
        timeoutMs={1000}
      />
    );

    const dataButton = screen.getAllByText('Data')[0]?.closest('button');
    await act(async () => {
      fireEvent.pointerDown(dataButton!);
      await Promise.resolve();
    });
    expect(echoLoader).toHaveBeenCalledOnce();

    // Two full settle windows with the pointer still down: the fallback
    // stays mounted, the loaded panel stays held back.
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId('interactive-utility-panel')
    ).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId('interactive-utility-panel')
    ).not.toBeInTheDocument();

    // Release completes the gesture: the click lands on the still-mounted
    // fallback option and replays into the panel.
    await act(async () => {
      fireEvent.pointerUp(window);
      fireEvent.click(dataButton!);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('interactive-utility-panel')).toHaveAttribute(
      'data-pending',
      'data'
    );
  });

  it('settles a press abandoned on page blur and swaps without replay', async () => {
    // A press whose completion can never arrive (tab switch, alert steals
    // focus) must not wedge the loaded panel on the fallback forever.
    const echoLoader = echoPanelLoader();
    render(
      <HeroUtilityPanelGate
        loadPanelModule={echoLoader as never}
        timeoutMs={1000}
      />
    );

    const dataButton = screen.getAllByText('Data')[0]?.closest('button');
    await act(async () => {
      fireEvent.pointerDown(dataButton!);
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId('interactive-utility-panel')
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.blur(window);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(echoLoader).toHaveBeenCalledOnce();
    expect(screen.getByTestId('interactive-utility-panel')).toHaveAttribute(
      'data-pending',
      'none'
    );
  });
});
