import './test-env.test-setup.mjs';
import { describe, expect, it, vi } from 'vitest';

const mockAbort = vi.fn();
const mockContinue = vi.fn();
const mockLaunch = vi.fn();

vi.mock('playwright', () => ({
  chromium: {
    launch: (...args) => mockLaunch(...args),
  },
}));

describe('launchIsolatedBrowser', () => {
  it('aborts non-localhost requests and redacts tokens in console errors', async () => {
    let routeHandler;
    const listeners = {};
    const page = {
      on: vi.fn((event, fn) => {
        listeners[event] = fn;
      }),
    };
    const context = {
      route: vi.fn((_pattern, handler) => {
        routeHandler = handler;
        return Promise.resolve();
      }),
      newPage: vi.fn().mockResolvedValue(page),
    };
    mockLaunch.mockResolvedValue({
      newContext: vi.fn(async () => context),
    });

    const { launchIsolatedBrowser } = await import('./browser-session.mjs');
    const state = {
      blockedOrigins: new Set(),
      browserSignals: {
        consoleErrors: [],
        pageErrors: 0,
        failedLocalRequests: 0,
      },
    };

    await launchIsolatedBrowser(state);

    routeHandler({
      request: () => ({ url: () => 'https://evil.example/track.js' }),
      abort: mockAbort,
      continue: mockContinue,
    });
    expect(mockAbort).toHaveBeenCalledTimes(1);
    expect([...state.blockedOrigins]).toEqual(['https://evil.example']);

    routeHandler({
      request: () => ({ url: () => 'https://localhost:43128/app.js' }),
      abort: mockAbort,
      continue: mockContinue,
    });
    expect(mockContinue).toHaveBeenCalledTimes(1);

    listeners.console({
      type: () => 'error',
      text: () =>
        'failed ?website_token=secret1234567890123456 with verylongsecretidentifiervalue1234567',
    });
    expect(state.browserSignals.consoleErrors[0]).toContain(
      'website_token=[redacted]'
    );
    expect(state.browserSignals.consoleErrors[0]).not.toContain(
      'secret1234567890123456'
    );
  });
});
