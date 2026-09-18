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

  it('drops the recorded tap when the gesture cancels before the chunk arrives', async () => {
    // pointerdown records the option and starts the load; the touch scroll
    // cancels the gesture before the chunk resolves, so no modal replays.
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

  it('drops the recorded tap when the shopper scrolls before the chunk arrives', async () => {
    const echoLoader = echoPanelLoader();
    render(
      <HeroUtilityPanelGate
        loadPanelModule={echoLoader as never}
        timeoutMs={1000}
      />
    );

    const dataButton = screen.getAllByText('Data')[0]?.closest('button');
    fireEvent.pointerDown(dataButton!);
    fireEvent.scroll(window);

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
