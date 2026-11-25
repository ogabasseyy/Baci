import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnowEffect } from './SnowEffect';

vi.mock('../providers/v2-theme-context', () => ({
  useV2Theme: () => ({ theme: 'santa' }),
}));

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  let reduce = initial;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return reduce && query.includes('prefers-reduced-motion');
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return (next: boolean) => {
    reduce = next;
    for (const listener of listeners) listener();
  };
}

describe('SnowEffect', () => {
  const raf = vi.fn(() => 1);
  const cancelRaf = vi.fn();

  beforeEach(() => {
    raf.mockClear();
    cancelRaf.mockClear();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', cancelRaf);
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    })) as unknown as HTMLCanvasElement['getContext'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('animates the snow canvas when motion is allowed', () => {
    stubMatchMedia(false);
    const { container } = render(<SnowEffect />);
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(raf).toHaveBeenCalled();
  });

  it('renders nothing and never animates when the shopper prefers reduced motion', () => {
    stubMatchMedia(true);
    const { container } = render(<SnowEffect />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });

  it('stops and restarts the snow when the setting changes while the page is open', () => {
    const setReducedMotion = stubMatchMedia(false);
    const { container } = render(<SnowEffect />);

    act(() => setReducedMotion(true));
    expect(container.querySelector('canvas')).toBeNull();
    expect(cancelRaf).toHaveBeenCalled();

    raf.mockClear();
    act(() => setReducedMotion(false));
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(raf).toHaveBeenCalled();
  });
});
