import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStylesheetAfterWindowLoad } from './load-stylesheet-after-window-load';

describe('loadStylesheetAfterWindowLoad', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete',
    });
  });

  it('loads immediately when the document is already complete', async () => {
    const load = vi.fn(() => Promise.resolve({}));

    const stop = loadStylesheetAfterWindowLoad(load, 'failed');

    expect(load).toHaveBeenCalledOnce();
    stop();
  });

  it('waits for window load when the document is still loading', () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'loading',
    });
    const load = vi.fn(() => Promise.resolve({}));
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const stop = loadStylesheetAfterWindowLoad(load, 'failed');

    expect(load).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith('load', expect.any(Function));

    const listener = add.mock.calls[0]?.[1];
    expect(typeof listener).toBe('function');
    (listener as EventListener)(new Event('load'));
    expect(load).toHaveBeenCalledOnce();

    stop();
    expect(remove).toHaveBeenCalledWith('load', listener);
  });

  it('logs stylesheet load failures with the provided context', async () => {
    const error = new Error('css failed');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const load = vi.fn(() => Promise.reject(error));

    loadStylesheetAfterWindowLoad(load, 'Failed to load storefront stylesheet');
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledOnce();
    });

    const [loggedError] = consoleError.mock.calls[0] ?? [];
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).toBe(
      'Failed to load storefront stylesheet'
    );
    expect((loggedError as Error).cause).toBe(error);
  });

  it('re-arms a retry trigger after a failed stylesheet import', async () => {
    const error = new Error('chunk missing');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce({});

    const stop = loadStylesheetAfterWindowLoad(load, 'failed');
    expect(load).toHaveBeenCalledOnce();

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledOnce();
    });

    window.dispatchEvent(new Event('pointerdown'));
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });
});
