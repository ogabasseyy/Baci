import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWhenPageActivated } from './run-when-page-activated';

function setDocumentPrerendering(value: boolean): void {
  Object.defineProperty(document, 'prerendering', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'prerendering');
  vi.restoreAllMocks();
});

describe('runWhenPageActivated', () => {
  it('runs the callback synchronously when the document is not prerendering', () => {
    // Arrange
    const callback = vi.fn();

    // Act
    runWhenPageActivated(callback);

    // Assert
    expect(callback).toHaveBeenCalledOnce();
  });

  it('does not swallow callback errors when the page is active', () => {
    // Arrange
    const error = new Error('unrelated client error');

    // Act and Assert
    expect(() =>
      runWhenPageActivated(() => {
        throw error;
      })
    ).toThrow(error);
  });

  it('defers the callback while the document is prerendering', () => {
    // Arrange
    setDocumentPrerendering(true);
    const callback = vi.fn();

    // Act
    runWhenPageActivated(callback);

    // Assert
    expect(callback).not.toHaveBeenCalled();
  });

  it('runs the callback once when the prerender is activated', () => {
    // Arrange
    setDocumentPrerendering(true);
    const callback = vi.fn();
    runWhenPageActivated(callback);

    // Act
    setDocumentPrerendering(false);
    document.dispatchEvent(new Event('prerenderingchange'));
    document.dispatchEvent(new Event('prerenderingchange'));

    // Assert
    expect(callback).toHaveBeenCalledOnce();
  });

  it('ignores prerenderingchange that fires while still prerendering', () => {
    // Arrange
    setDocumentPrerendering(true);
    const callback = vi.fn();
    runWhenPageActivated(callback);

    // Act — flag still set (spurious event)
    document.dispatchEvent(new Event('prerenderingchange'));

    // Assert
    expect(callback).not.toHaveBeenCalled();
  });

  it('never runs the callback after the canceller detaches the pending listener', () => {
    // Arrange
    setDocumentPrerendering(true);
    const callback = vi.fn();
    const cancel = runWhenPageActivated(callback);

    // Act — a discarded prerender is cancelled before it ever activates.
    cancel();
    setDocumentPrerendering(false);
    document.dispatchEvent(new Event('prerenderingchange'));

    // Assert
    expect(callback).not.toHaveBeenCalled();
  });
});
