import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStylesheetAfterFirstInput } from './load-stylesheet-after-first-input';

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches,
    media: '(min-width: 768px)',
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      }
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      }
    ),
    dispatch(nextMatches: boolean) {
      media.matches = nextMatches;
      const event = { matches: nextMatches } as MediaQueryListEvent;
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
  window.matchMedia = vi.fn(() => media as unknown as MediaQueryList);
  return media;
}

describe('loadStylesheetAfterFirstInput', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete',
    });
  });

  it('loads after window load on a desktop viewport', () => {
    stubMatchMedia(true);
    const load = vi.fn(() => Promise.resolve({}));

    const stop = loadStylesheetAfterFirstInput(load, 'failed');

    expect(load).toHaveBeenCalledOnce();
    stop();
  });

  it('does not load on a mobile viewport until the first input', () => {
    stubMatchMedia(false);
    const load = vi.fn(() => Promise.resolve({}));

    const stop = loadStylesheetAfterFirstInput(load, 'failed');

    expect(load).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));
    expect(load).toHaveBeenCalledOnce();
    stop();
  });

  it('loads when a mobile viewport becomes desktop', () => {
    const media = stubMatchMedia(false);
    const load = vi.fn(() => Promise.resolve({}));

    const stop = loadStylesheetAfterFirstInput(load, 'failed');

    expect(load).not.toHaveBeenCalled();
    media.dispatch(true);
    expect(load).toHaveBeenCalledOnce();
    stop();
  });

  it('re-arms the first-input loader after a failed stylesheet import', async () => {
    stubMatchMedia(false);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('chunk missing'))
      .mockResolvedValueOnce({});
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const stop = loadStylesheetAfterFirstInput(load, 'failed');

    window.dispatchEvent(new Event('pointerdown'));
    expect(load).toHaveBeenCalledOnce();

    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('pointerdown'));
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('re-arms desktop stylesheet loading after a failed window-load import', async () => {
    stubMatchMedia(true);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('chunk missing'))
      .mockResolvedValueOnce({});
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const stop = loadStylesheetAfterFirstInput(load, 'failed');
    expect(load).toHaveBeenCalledOnce();

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledOnce();
    });

    window.dispatchEvent(new Event('pointerdown'));
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });
});
