import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeferredPlatformInsights } from '@/components/analytics/deferred-platform-insights';

describe('DeferredPlatformInsights', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('location', new URL('https://ogabassey.com/'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    'localhost',
    '127.0.0.1',
    '[::1]',
  ])('does not request Vercel-only scripts on %s', async (hostname) => {
    vi.stubGlobal('location', new URL(`http://${hostname}/`));
    const loadModules = vi.fn().mockResolvedValue({});
    render(
      <DeferredPlatformInsights timeoutMs={1} loadModules={loadModules} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(loadModules).not.toHaveBeenCalled();
  });

  it('does not render the Vercel scripts before activation', () => {
    render(
      <DeferredPlatformInsights
        loadModules={vi.fn().mockResolvedValue({
          Analytics: () => <div>Analytics</div>,
          SpeedInsights: () => <div>SpeedInsights</div>,
        })}
      />
    );

    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('SpeedInsights')).not.toBeInTheDocument();
  });

  it('renders the Vercel scripts after the fallback timeout', async () => {
    const loadModules = vi.fn().mockResolvedValue({
      Analytics: () => <div>Analytics</div>,
      SpeedInsights: () => <div>SpeedInsights</div>,
    });
    const readyStateSpy = vi
      .spyOn(document, 'readyState', 'get')
      .mockReturnValue('loading');

    render(
      <DeferredPlatformInsights timeoutMs={1} loadModules={loadModules} />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(loadModules).toHaveBeenCalledOnce();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('SpeedInsights')).toBeInTheDocument();

    readyStateSpy.mockRestore();
  });

  it('waits for the timeout when the document is already complete', async () => {
    const loadModules = vi.fn().mockResolvedValue({
      Analytics: () => <div>Analytics</div>,
      SpeedInsights: () => <div>SpeedInsights</div>,
    });
    const readyStateSpy = vi
      .spyOn(document, 'readyState', 'get')
      .mockReturnValue('complete');

    render(
      <DeferredPlatformInsights timeoutMs={50} loadModules={loadModules} />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(49);
      await Promise.resolve();
    });

    expect(loadModules).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(loadModules).toHaveBeenCalledOnce();
    readyStateSpy.mockRestore();
  });

  it('fails open when an optional insight chunk rejects with Safari Load failed', async () => {
    const loadModules = vi.fn().mockRejectedValue(new TypeError('Load failed'));
    const readyStateSpy = vi
      .spyOn(document, 'readyState', 'get')
      .mockReturnValue('complete');

    render(
      <DeferredPlatformInsights timeoutMs={1} loadModules={loadModules} />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadModules).toHaveBeenCalledOnce();
    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('SpeedInsights')).not.toBeInTheDocument();

    readyStateSpy.mockRestore();
  });
});
