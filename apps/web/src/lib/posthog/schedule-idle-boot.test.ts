import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleIdleBoot } from './schedule-idle-boot';

interface IdleCallbackStub {
  request: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  run: () => void;
}

function stubRequestIdleCallback(): IdleCallbackStub {
  let pending: (() => void) | undefined;
  const request = vi.fn((callback: () => void) => {
    pending = callback;
    return 1;
  });
  const cancel = vi.fn();

  vi.stubGlobal('requestIdleCallback', request);
  vi.stubGlobal('cancelIdleCallback', cancel);

  return {
    request,
    cancel,
    run: () => pending?.(),
  };
}

function setDocumentPrerendering(value: boolean): void {
  Object.defineProperty(document, 'prerendering', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'prerendering');
});

describe('scheduleIdleBoot', () => {
  it('never runs the callback and returns a no-op canceller without a window', () => {
    // Arrange
    vi.stubGlobal('window', undefined);
    const callback = vi.fn();

    // Act
    const cancel = scheduleIdleBoot(callback);
    cancel();

    // Assert
    expect(callback).not.toHaveBeenCalled();
  });

  it('defers the callback instead of running it synchronously', () => {
    // Arrange
    vi.useFakeTimers();
    const callback = vi.fn();

    // Act
    scheduleIdleBoot(callback, { timeoutMs: 4000 });

    // Assert
    expect(callback).not.toHaveBeenCalled();
  });

  it('runs the callback once the browser reports an idle period', () => {
    // Arrange
    const idle = stubRequestIdleCallback();
    const callback = vi.fn();

    // Act
    scheduleIdleBoot(callback, { timeoutMs: 4000 });
    expect(callback).not.toHaveBeenCalled();
    idle.run();

    // Assert
    expect(idle.request).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('boots immediately on the first pointer interaction before idle', () => {
    // Arrange
    stubRequestIdleCallback();
    const callback = vi.fn();

    // Act
    scheduleIdleBoot(callback, { timeoutMs: 4000 });
    window.dispatchEvent(new Event('pointerdown'));

    // Assert
    expect(callback).toHaveBeenCalledOnce();
  });

  it('boots on the first keydown interaction', () => {
    // Arrange
    stubRequestIdleCallback();
    const callback = vi.fn();

    // Act
    scheduleIdleBoot(callback, { timeoutMs: 4000 });
    window.dispatchEvent(new Event('keydown'));

    // Assert
    expect(callback).toHaveBeenCalledOnce();
  });

  it('runs via the idle fallback timer when requestIdleCallback is unavailable', () => {
    // Arrange
    vi.useFakeTimers();
    const callback = vi.fn();

    // Act
    scheduleIdleBoot(callback, { timeoutMs: 4000 });
    vi.advanceTimersByTime(0);

    // Assert
    expect(callback).toHaveBeenCalledOnce();
  });

  it('runs on the hard timeout when the window has not finished loading', () => {
    // Arrange
    vi.useFakeTimers();
    const readyState = vi
      .spyOn(document, 'readyState', 'get')
      .mockReturnValue('loading');
    const callback = vi.fn();

    // Act
    scheduleIdleBoot(callback, { timeoutMs: 4000 });
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);

    // Assert
    expect(callback).toHaveBeenCalledOnce();
    readyState.mockRestore();
  });

  it('reports which trigger fired the callback', () => {
    // Arrange
    const idle = stubRequestIdleCallback();

    // Act: idle period → 'idle'.
    const idleCallback = vi.fn();
    const cancelIdle = scheduleIdleBoot(idleCallback, { timeoutMs: 4000 });
    idle.run();

    // Assert
    expect(idleCallback).toHaveBeenCalledOnce();
    expect(idleCallback).toHaveBeenCalledWith('idle');
    cancelIdle();

    // Act: first interaction → 'interaction'.
    const interactionCallback = vi.fn();
    scheduleIdleBoot(interactionCallback, { timeoutMs: 4000 });
    window.dispatchEvent(new Event('pointerdown'));

    // Assert
    expect(interactionCallback).toHaveBeenCalledOnce();
    expect(interactionCallback).toHaveBeenCalledWith('interaction');
  });

  it('reports the hard timeout trigger', () => {
    // Arrange
    vi.useFakeTimers();
    const readyState = vi
      .spyOn(document, 'readyState', 'get')
      .mockReturnValue('loading');
    const callback = vi.fn();

    // Act
    scheduleIdleBoot(callback, { timeoutMs: 4000 });
    vi.advanceTimersByTime(4000);

    // Assert
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('timeout');
    readyState.mockRestore();
  });

  it('runs the callback at most once across triggers', () => {
    // Arrange
    const idle = stubRequestIdleCallback();
    const callback = vi.fn();

    // Act
    scheduleIdleBoot(callback, { timeoutMs: 4000 });
    window.dispatchEvent(new Event('pointerdown'));
    idle.run();
    window.dispatchEvent(new Event('keydown'));

    // Assert
    expect(callback).toHaveBeenCalledOnce();
  });

  it('does not run the callback after the canceller fires', () => {
    // Arrange
    const idle = stubRequestIdleCallback();
    const callback = vi.fn();

    // Act
    const cancel = scheduleIdleBoot(callback, { timeoutMs: 4000 });
    cancel();
    idle.run();
    window.dispatchEvent(new Event('pointerdown'));

    // Assert
    expect(callback).not.toHaveBeenCalled();
    expect(idle.cancel).toHaveBeenCalledOnce();
  });

  it('does not arm the boot gate while the document is prerendering', () => {
    // Arrange
    const idle = stubRequestIdleCallback();
    setDocumentPrerendering(true);
    const callback = vi.fn();

    // Act
    const cancel = scheduleIdleBoot(callback, { timeoutMs: 4000 });
    window.dispatchEvent(new Event('pointerdown'));

    // Assert
    expect(idle.request).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();

    // Detach the pending prerendering listener so it cannot fire in later tests
    // (jsdom's document persists across tests in this file).
    cancel();
  });

  it('arms the gate and boots once the prerender activates', () => {
    // Arrange
    const idle = stubRequestIdleCallback();
    setDocumentPrerendering(true);
    const callback = vi.fn();

    // Act
    scheduleIdleBoot(callback, { timeoutMs: 4000 });
    setDocumentPrerendering(false);
    document.dispatchEvent(new Event('prerenderingchange'));
    idle.run();

    // Assert
    expect(idle.request).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('never boots when a prerender is discarded without activating', () => {
    // Arrange
    const idle = stubRequestIdleCallback();
    setDocumentPrerendering(true);
    const callback = vi.fn();

    // Act
    const cancel = scheduleIdleBoot(callback, { timeoutMs: 4000 });
    window.dispatchEvent(new Event('pointerdown'));
    idle.run();

    // Assert
    expect(callback).not.toHaveBeenCalled();

    // A discarded prerender never fires prerenderingchange; detach the pending
    // listener so it cannot leak into a later test.
    cancel();
  });

  it('detaches the prerendering listener when cancelled before activation', () => {
    // Arrange
    setDocumentPrerendering(true);
    const callback = vi.fn();

    // Act
    const cancel = scheduleIdleBoot(callback, { timeoutMs: 4000 });
    cancel();
    setDocumentPrerendering(false);
    document.dispatchEvent(new Event('prerenderingchange'));

    // Assert
    expect(callback).not.toHaveBeenCalled();
  });
});
