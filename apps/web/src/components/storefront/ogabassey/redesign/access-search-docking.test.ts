import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachSearchDocking } from './access-search-docking';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('search docking', () => {
  it('docks on intersection changes without measuring every scroll event', () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    const resizeDisconnect = vi.fn();
    let emitIntersection:
      | ((bottom: number, isIntersecting: boolean) => void)
      | undefined;
    let notifyResize: ResizeObserverCallback | undefined;
    let observerOptions: IntersectionObserverInit | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(
          callback: IntersectionObserverCallback,
          options: IntersectionObserverInit
        ) {
          emitIntersection = (bottom, isIntersecting) =>
            callback(
              [
                {
                  boundingClientRect: { bottom },
                  isIntersecting,
                } as IntersectionObserverEntry,
              ],
              this as unknown as IntersectionObserver
            );
          observerOptions = options;
        }
        observe = observe;
        disconnect = disconnect;
      }
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = callback;
        }
        observe() {}
        disconnect = resizeDisconnect;
      }
    );
    const frame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', frame);

    const slot = document.createElement('div');
    const input = document.createElement('input');
    const header = document.createElement('header');
    slot.append(input);
    document.body.append(header, slot);
    input.value = 'iPad';
    input.focus();
    let headerHeight = 120;
    Object.defineProperty(header, 'offsetHeight', { get: () => headerHeight });
    vi.stubGlobal('scrollY', 0);
    const scrollTo = (offset: number) => vi.stubGlobal('scrollY', offset);
    let bottom = 450;
    const measure = vi.spyOn(slot, 'getBoundingClientRect').mockImplementation(
      () => ({ bottom, height: 126, top: bottom - 126 }) as DOMRect
    );
    const cleanup = attachSearchDocking(slot, header);
    expect(observerOptions?.rootMargin).toBe('-120px 0px 0px 0px');
    expect(observe).toHaveBeenCalledWith(slot);
    expect(slot.dataset.docked).toBe('false');

    measure.mockClear();
    window.dispatchEvent(new Event('scroll'));
    expect(frame).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();

    emitIntersection?.(450, true);
    measure.mockClear();
    scrollTo(100);
    document.dispatchEvent(new Event('scrollend'));
    expect(measure).not.toHaveBeenCalled();

    bottom = 119;
    emitIntersection?.(119, false);
    expect(measure).toHaveBeenCalledOnce();
    expect(slot.dataset.docked).toBe('true');
    expect(header.dataset.oaSearchDocked).toBe('true');
    expect(slot.style.getPropertyValue('--oa-search-slot-height')).toBe('126px');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('iPad');
    measure.mockClear();
    scrollTo(250);
    document.dispatchEvent(new Event('scrollend'));
    expect(measure).not.toHaveBeenCalled();

    headerHeight = 96;
    bottom = 70;
    notifyResize?.([], {} as ResizeObserver);
    expect(observerOptions?.rootMargin).toBe('-96px 0px 0px 0px');
    expect(slot.style.getPropertyValue('--oa-search-top')).toBe('96px');
    expect(slot.dataset.docked).toBe('true');
    bottom = 96;
    emitIntersection?.(96, true);
    expect(slot.dataset.docked).toBe('false');

    bottom = 1_200;
    emitIntersection?.(1_200, false);
    bottom = -300;
    scrollTo(1_750);
    document.dispatchEvent(new Event('scrollend'));
    expect(slot.dataset.docked).toBe('true');

    bottom = 1_200;
    scrollTo(250);
    document.dispatchEvent(new Event('scrollend'));
    expect(slot.dataset.docked).toBe('false');

    // An observer entry sampled before the jump can arrive after the jump.
    bottom = -300;
    scrollTo(1_750);
    emitIntersection?.(1_200, false);
    document.dispatchEvent(new Event('scrollend'));
    expect(slot.dataset.docked).toBe('true');

    cleanup?.();
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    expect(slot.dataset.docked).toBeUndefined();
    expect(header.dataset.oaSearchDocked).toBeUndefined();
    expect(slot.style.getPropertyValue('--oa-search-slot-height')).toBe('');
  });

  it('keeps the inline search when intersection observation is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const slot = document.createElement('div');
    const cleanup = attachSearchDocking(slot, null);
    expect(slot.dataset.docked).toBeUndefined();
    cleanup?.();
  });
});
