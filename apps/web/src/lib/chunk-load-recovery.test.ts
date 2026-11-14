// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChunkLoadRecoveryRuntime,
  createChunkLoadRecoveryHandlers,
  isChunkRecoveryReloadPending,
  resetChunkLoadRecoveryStateForTests,
} from './chunk-load-recovery';

const NEXT_DEPLOYMENT_ID_GLOBAL = 'NEXT_DEPLOYMENT_ID';

function createRuntime(overrides: Partial<ChunkLoadRecoveryRuntime> = {}) {
  const storage = new Map<string, string>();
  const runtime: ChunkLoadRecoveryRuntime = {
    getDeploymentId: () => 'deploy-1',
    getPathname: () => '/checkout',
    getSessionStorage: () => ({
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    }),
    reload: vi.fn(),
    sendTelemetry: vi.fn(),
    ...overrides,
  };
  return { runtime, storage };
}

function stubWindowLocation() {
  const reload = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    pathname: '/checkout',
    reload,
  } as unknown as Location);
  return reload;
}

beforeEach(() => {
  resetChunkLoadRecoveryStateForTests();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, NEXT_DEPLOYMENT_ID_GLOBAL);
  delete document.documentElement.dataset.dplId;
  document.head.innerHTML = '';
  window.name = '';
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('chunk-load recovery', () => {
  it('reloads once for ChunkLoadError promise rejections', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    handlers.handleUnhandledRejection({
      reason: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
    });
    handlers.handleUnhandledRejection({
      reason: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
    });

    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads for named chunk loading failures', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    handlers.handleUnhandledRejection({
      reason: new Error('Loading chunk app/layout failed.'),
    });

    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('recovers from chunk load errors without suppressing analytics visibility', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    handlers.handleWindowError({
      error: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
      message: 'ChunkLoadError',
    });

    expect(runtime.reload).toHaveBeenCalledOnce();
  });

  it('does not reload for unrelated runtime errors', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    handlers.handleWindowError({
      error: new Error('maximumFractionDigits value is out of range'),
      message: 'maximumFractionDigits value is out of range',
    });

    expect(runtime.reload).not.toHaveBeenCalled();
    expect(runtime.sendTelemetry).not.toHaveBeenCalled();
  });

  it('reloads for resource error events on Next assets', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);
    const script = document.createElement('script');
    script.src = '/_next/static/chunks/page-abc.js?dpl=deploy-old';

    handlers.handleWindowError({
      error: undefined,
      message: undefined as unknown as string,
      target: script,
    });

    expect(runtime.reload).toHaveBeenCalledOnce();
    expect(runtime.sendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reload',
        failedAssetDeploymentId: 'deploy-old',
        triggerSource: 'resource-error',
      })
    );
  });

  it('ignores resource error events on third-party assets', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);
    const script = document.createElement('script');
    script.src = 'https://cdn.example.com/widget.js';

    handlers.handleWindowError({
      error: undefined,
      message: undefined as unknown as string,
      target: script,
    });

    expect(runtime.reload).not.toHaveBeenCalled();
  });

  it('emits telemetry for reloads and declined recoveries', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);
    const rejection = {
      reason: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js?dpl=deploy-1'
      ),
    };

    handlers.handleUnhandledRejection(rejection);
    handlers.handleUnhandledRejection(rejection);

    expect(runtime.sendTelemetry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'reload',
        failedAssetDeploymentId: 'deploy-1',
        pageDeploymentId: 'deploy-1',
        pathname: '/checkout',
        triggerSource: 'unhandled-rejection',
      })
    );
    expect(runtime.sendTelemetry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'skipped-already-attempted' })
    );
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload while offline', () => {
    const { runtime } = createRuntime({ isOffline: () => true });
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    handlers.handleUnhandledRejection({
      reason: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
    });

    expect(runtime.reload).not.toHaveBeenCalled();
    expect(runtime.sendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'skipped-offline' })
    );
  });

  it('recovers once via window.name when sessionStorage is unavailable', () => {
    let windowName = '';
    const reload = vi.fn();
    const handlers = createChunkLoadRecoveryHandlers({
      getDeploymentId: () => 'deploy-1',
      getPathname: () => '/checkout',
      getSessionStorage: () => {
        throw new Error('storage unavailable');
      },
      getWindowName: () => windowName,
      reload,
      setWindowName: (value) => {
        windowName = value;
      },
    });

    handlers.handleUnhandledRejection({
      reason: 'Failed to load chunk /_next/static/chunks/app.js',
    });
    handlers.handleUnhandledRejection({
      reason: 'Failed to load chunk /_next/static/chunks/app.js',
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when no loop guard can persist', () => {
    const reload = vi.fn();
    const handlers = createChunkLoadRecoveryHandlers({
      getDeploymentId: () => 'deploy-1',
      getPathname: () => '/checkout',
      getSessionStorage: () => {
        throw new Error('storage unavailable');
      },
      reload,
    });

    handlers.handleUnhandledRejection({
      reason: 'Failed to load chunk /_next/static/chunks/app.js',
    });
    handlers.handleUnhandledRejection({
      reason: 'Failed to load chunk /_next/static/chunks/app.js',
    });

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once for a stale chunk from a previous deployment id', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    handlers.handleUnhandledRejection({
      reason: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/old-page.js?dpl=deploy-previous from module 7'
      ),
    });

    expect(runtime.reload).toHaveBeenCalledTimes(1);
    expect(runtime.sendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reload',
        failedAssetDeploymentId: 'deploy-previous',
        pageDeploymentId: 'deploy-1',
      })
    );
  });
});

describe('reload-pending state', () => {
  it('reports a pending reload only after recovery actually schedules one', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    expect(isChunkRecoveryReloadPending()).toBe(false);

    handlers.handleUnhandledRejection({
      reason: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
    });

    expect(runtime.reload).toHaveBeenCalledTimes(1);
    expect(isChunkRecoveryReloadPending()).toBe(true);
  });

  it('stays pending across a burst of declined follow-up failures', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);
    const rejection = {
      reason: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
    };

    handlers.handleUnhandledRejection(rejection);
    handlers.handleUnhandledRejection(rejection);

    expect(runtime.reload).toHaveBeenCalledTimes(1);
    expect(isChunkRecoveryReloadPending()).toBe(true);
  });

  it('is not pending on a fresh page load when the guard already declined the reload', () => {
    // Simulates the post-reload page: recovery module state is fresh but the
    // sessionStorage guard was consumed by the previous page's reload, so the
    // repeat failure must stay fully visible to error tracking.
    const { runtime, storage } = createRuntime();
    storage.set('baci:chunk-load-recovery:deploy-1::/checkout', '1');
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    handlers.handleUnhandledRejection({
      reason: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
    });

    expect(runtime.reload).not.toHaveBeenCalled();
    expect(runtime.sendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'skipped-already-attempted' })
    );
    expect(isChunkRecoveryReloadPending()).toBe(false);
  });

  it('expires when the scheduled reload never navigates', () => {
    let nowMs = 1_000_000;
    const { runtime } = createRuntime({ getNow: () => nowMs });
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    handlers.handleUnhandledRejection({
      reason: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
    });
    expect(isChunkRecoveryReloadPending(nowMs)).toBe(true);

    nowMs += 11_000;

    expect(isChunkRecoveryReloadPending(nowMs)).toBe(false);
  });

  it('is not pending when recovery declines for offline clients', () => {
    const { runtime } = createRuntime({ isOffline: () => true });
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    handlers.handleUnhandledRejection({
      reason: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
    });

    expect(runtime.reload).not.toHaveBeenCalled();
    expect(isChunkRecoveryReloadPending()).toBe(false);
  });

  it('is not set by unrelated runtime errors', () => {
    const { runtime } = createRuntime();
    const handlers = createChunkLoadRecoveryHandlers(runtime);

    handlers.handleWindowError({
      error: new Error('maximumFractionDigits value is out of range'),
      message: 'maximumFractionDigits value is out of range',
    });

    expect(isChunkRecoveryReloadPending()).toBe(false);
  });
});

describe('browser initialization', () => {
  it('initializes browser chunk recovery listeners once', async () => {
    vi.resetModules();
    const addEventListenerSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation(() => undefined);
    const { initializeChunkLoadRecovery } = await import(
      './chunk-load-recovery'
    );

    initializeChunkLoadRecovery();
    initializeChunkLoadRecovery();

    expect(addEventListenerSpy).toHaveBeenCalledTimes(2);
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
      { capture: true }
    );
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'unhandledrejection',
      expect.any(Function),
      { capture: true }
    );
  });

  it('keys browser recovery with loaded Next assets when no deployment id global remains', async () => {
    vi.resetModules();
    document.head.innerHTML = `
      <script src="/_next/static/chunks/app/checkout-abc123.js"></script>
      <link rel="stylesheet" href="https://cdn.example.com/_next/static/css/layout-def456.css" />
    `;
    stubWindowLocation();
    const addEventListenerSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation(() => undefined);
    const { initializeChunkLoadRecovery } = await import(
      './chunk-load-recovery'
    );

    initializeChunkLoadRecovery();
    const errorListener = addEventListenerSpy.mock.calls.find(
      ([eventName]) => eventName === 'error'
    )?.[1];
    expect(errorListener).toEqual(expect.any(Function));

    (errorListener as EventListener)({
      error: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
      message: 'ChunkLoadError',
    } as unknown as Event);

    expect(
      Object.keys(window.sessionStorage).filter((key) =>
        key.startsWith('baci:chunk-load-recovery:assets-')
      )
    ).toEqual([
      expect.stringMatching(
        /^baci:chunk-load-recovery:assets-[a-z0-9]+:localhost:3000:\/checkout$/
      ),
    ]);
  });

  it('uses a stable dpl query value before asset hashing', async () => {
    vi.resetModules();
    document.head.innerHTML = `
      <script src="/_next/static/chunks/app/layout-abc123.js?dpl=deploy-123"></script>
      <script src="/_next/static/chunks/app/page-def456.js?dpl=deploy-123"></script>
    `;
    stubWindowLocation();
    const addEventListenerSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation(() => undefined);
    const { initializeChunkLoadRecovery } = await import(
      './chunk-load-recovery'
    );

    initializeChunkLoadRecovery();
    const errorListener = addEventListenerSpy.mock.calls.find(
      ([eventName]) => eventName === 'error'
    )?.[1];

    (errorListener as EventListener)({
      error: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
      message: 'ChunkLoadError',
    } as unknown as Event);

    expect(
      window.sessionStorage.getItem(
        'baci:chunk-load-recovery:dpl:deploy-123:localhost:3000:/checkout'
      )
    ).toBe('1');
  });

  it('freezes the loaded-asset fallback at initialization', async () => {
    vi.resetModules();
    document.head.innerHTML = `
      <script src="/_next/static/chunks/app/initial-abc123.js"></script>
    `;
    stubWindowLocation();
    const addEventListenerSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation(() => undefined);
    const { initializeChunkLoadRecovery } = await import(
      './chunk-load-recovery'
    );

    initializeChunkLoadRecovery();
    document.head.insertAdjacentHTML(
      'beforeend',
      '<script src="/_next/static/chunks/app/later-def456.js?dpl=later-deploy"></script>'
    );
    const errorListener = addEventListenerSpy.mock.calls.find(
      ([eventName]) => eventName === 'error'
    )?.[1];

    (errorListener as EventListener)({
      error: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
      message: 'ChunkLoadError',
    } as unknown as Event);

    const keys = Object.keys(window.sessionStorage).filter((key) =>
      key.startsWith('baci:chunk-load-recovery:')
    );
    expect(keys.join(' ')).not.toContain('later-deploy');
    expect(keys).toContainEqual(
      expect.stringMatching(
        /^baci:chunk-load-recovery:assets-[a-z0-9]+:localhost:3000:\/checkout$/
      )
    );
  });

  it('keys browser recovery with Next deployment id after Next removes data-dpl-id', async () => {
    vi.resetModules();
    Object.defineProperty(globalThis, NEXT_DEPLOYMENT_ID_GLOBAL, {
      configurable: true,
      value: 'next-global-deploy',
    });
    stubWindowLocation();
    const addEventListenerSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation(() => undefined);
    const { initializeChunkLoadRecovery } = await import(
      './chunk-load-recovery'
    );

    initializeChunkLoadRecovery();
    const errorListener = addEventListenerSpy.mock.calls.find(
      ([eventName]) => eventName === 'error'
    )?.[1];

    (errorListener as EventListener)({
      error: new Error(
        'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
      ),
      message: 'ChunkLoadError',
    } as unknown as Event);

    expect(
      window.sessionStorage.getItem(
        'baci:chunk-load-recovery:next-global-deploy:localhost:3000:/checkout'
      )
    ).toBe('1');
  });
});

describe('boundary recovery API', () => {
  it('schedules a reload for boundary-caught chunk errors and reports pending state', async () => {
    vi.resetModules();
    Object.defineProperty(globalThis, NEXT_DEPLOYMENT_ID_GLOBAL, {
      configurable: true,
      value: 'boundary-deploy',
    });
    const reload = stubWindowLocation();
    const { attemptChunkLoadRecoveryFromBoundary, isChunkLoadRecoveryPending } =
      await import('./chunk-load-recovery');
    const error = new Error(
      'ChunkLoadError: Failed to load chunk /_next/static/chunks/app.js'
    );

    expect(isChunkLoadRecoveryPending(error)).toBe(true);
    expect(attemptChunkLoadRecoveryFromBoundary(error)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    expect(isChunkLoadRecoveryPending(error)).toBe(false);
    expect(attemptChunkLoadRecoveryFromBoundary(error)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not engage for non-chunk boundary errors', async () => {
    vi.resetModules();
    const reload = stubWindowLocation();
    const { attemptChunkLoadRecoveryFromBoundary, isChunkLoadRecoveryPending } =
      await import('./chunk-load-recovery');
    const error = new Error('regular render failure');

    expect(isChunkLoadRecoveryPending(error)).toBe(false);
    expect(attemptChunkLoadRecoveryFromBoundary(error)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
