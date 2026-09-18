import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroUtilityPanelGate } from './hero-utility-panel-gate';
import {
  echoPanelLoader,
  setupGateHarness,
  teardownGateHarness,
} from './hero-utility-panel-gate-test-setup';

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

  it('never replays a press without click completion (scroll gesture)', async () => {
    // pointerdown starts the load but records nothing; the swipe ends
    // without a click, so the panel mounts with no replay.
    const echoLoader = echoPanelLoader();
    render(
      <HeroUtilityPanelGate
        loadPanelModule={echoLoader as never}
        timeoutMs={1000}
      />
    );

    const dataButton = screen.getAllByText('Data')[0]?.closest('button');
    fireEvent.pointerDown(dataButton!);
    fireEvent.pointerCancel(window);

    await act(async () => {
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

  it('never replays when a cached chunk mounts before the tap completes', async () => {
    // Fast-load race: the press starts the load and the already-cached
    // chunk mounts the panel before pointerup/click can run, so there is
    // no recording to replay — and no scroll modal either.
    const echoLoader = echoPanelLoader();
    render(
      <HeroUtilityPanelGate
        loadPanelModule={echoLoader as never}
        timeoutMs={1000}
      />
    );

    const dataButton = screen.getAllByText('Data')[0]?.closest('button');
    fireEvent.pointerDown(dataButton!);

    await act(async () => {
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
