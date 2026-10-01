import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroUtilityPanelGate } from './hero-utility-panel-gate';
import { HeroUtilityPanelStatic } from './hero-utility-panel-static';
import {
  echoPanelLoader,
  fireViewportApproach,
  renderGate,
  settleLcpSignal,
  setupGateHarness,
  teardownGateHarness,
} from './hero-utility-panel-gate-test-setup';

const mocks = vi.hoisted(() => ({
  // The gate defers to the post-LCP signal; resolve immediately so timing
  // stays deterministic under jsdom, which never emits LCP entries. The
  // settle mechanics are covered in wait-for-lcp.test.ts.
  waitForLcpWindowEnd: vi.fn(async () => undefined),
}));

vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: mocks.waitForLcpWindowEnd,
}));

describe('HeroUtilityPanelGate', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = setupGateHarness();
  });

  afterEach(() => {
    teardownGateHarness(consoleErrorSpy);
  });

  it('renders the non-interactive static fallback without loading the panel module', () => {
    const { loader } = renderGate();

    expect(
      screen
        .getAllByText(/we pay/i)[0]
        ?.closest('[data-ogabassey-hero-utility="true"]')
    ).not.toBeNull();
    // Deliberately NOT inert: inert subtrees are excluded from hit testing,
    // which would hide the tapped option from first-tap replay. The shell
    // is aria-hidden with unfocusable buttons instead.
    const shell = document.querySelector(
      '[data-ogabassey-hero-utility-gate="true"]'
    );
    expect(shell).toHaveAttribute('aria-hidden', 'true');
    expect(shell).not.toHaveAttribute('inert');
    for (const button of screen.getAllByRole('button', { hidden: true })) {
      expect(button).toHaveAttribute('tabindex', '-1');
    }
    expect(loader).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('interactive-utility-panel')
    ).not.toBeInTheDocument();
  });

  it('loads the panel module once the panel approaches the viewport', async () => {
    const { loader } = renderGate();
    await settleLcpSignal();

    expect(loader).not.toHaveBeenCalled();

    await act(async () => {
      fireViewportApproach();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('interactive-utility-panel')
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ogabassey-hero-utility-gate="true"]')
    ).toBeNull();
  });

  it('holds the chunk while the LCP window is pending despite intersection', async () => {
    // The panel sits inside the expanded initial viewport on mobile: the
    // observer fires on hydration, but the import must wait for the
    // post-LCP signal (or interaction) instead of racing the hero.
    let resolveLcpWindow: () => void = () => undefined;
    mocks.waitForLcpWindowEnd.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        resolveLcpWindow = () => resolve(undefined);
      })
    );
    const { loader } = renderGate();

    await act(async () => {
      fireViewportApproach();
      await Promise.resolve();
    });
    expect(loader).not.toHaveBeenCalled();

    await act(async () => {
      resolveLcpWindow();
      await Promise.resolve();
    });
    await act(async () => {
      fireViewportApproach();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('interactive-utility-panel')
    ).toBeInTheDocument();
  });

  it('loads the panel on first pointer interaction before the viewport fires', async () => {
    const { loader } = renderGate();

    await act(async () => {
      // The press stays in flight, so the loaded panel holds the fallback
      // mounted until the press completes.
      fireEvent.pointerDown(window);
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId('interactive-utility-panel')
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.pointerUp(window);
      await Promise.resolve();
    });
    // Release alone does not end the hold — the completing click may still
    // be dispatching. A press with no click settles on the timer bound.
    expect(
      screen.queryByTestId('interactive-utility-panel')
    ).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('interactive-utility-panel')
    ).toBeInTheDocument();
  });

  it('replays a fallback option tap into the interactive panel', async () => {
    // The inert fallback swallows the activating click; the gate records the
    // tapped option and replays it so the shopper does not have to tap twice.
    const echoLoader = echoPanelLoader();
    render(
      <HeroUtilityPanelGate fallback={<HeroUtilityPanelStatic />}
        loadPanelModule={echoLoader as never}
        timeoutMs={1000}
      />
    );

    const dataButton = screen.getAllByText('Data')[0]?.closest('button');
    expect(dataButton).toHaveAttribute('data-utility-option', 'data');

    await act(async () => {
      fireEvent.click(dataButton!);
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

  it('activates without a replay for taps outside the fallback options', async () => {
    const echoLoader = echoPanelLoader();
    render(
      <HeroUtilityPanelGate fallback={<HeroUtilityPanelStatic />}
        loadPanelModule={echoLoader as never}
        timeoutMs={1000}
      />
    );

    await act(async () => {
      fireEvent.pointerDown(window);
      await Promise.resolve();
    });
    // The press stays in flight until it completes; a bare press holds the
    // swap just like a tap does — release alone does not end it.
    await act(async () => {
      fireEvent.pointerUp(window);
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId('interactive-utility-panel')
    ).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(500);
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

  it('loads the panel on first keyboard interaction', async () => {
    const { loader } = renderGate();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Tab' });
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('interactive-utility-panel')
    ).toBeInTheDocument();
  });

  it('loads the panel module after the backstop timeout', async () => {
    const { loader } = renderGate();
    await settleLcpSignal();

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(loader).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('interactive-utility-panel')
    ).toBeInTheDocument();
  });

  it('removes interaction listeners on unmount before activation', () => {
    const { loader, unmount } = renderGate();

    unmount();
    fireEvent.pointerDown(window);
    fireEvent.keyDown(window, { key: 'Tab' });

    expect(loader).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
