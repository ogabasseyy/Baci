import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const themeState = vi.hoisted(() => ({ theme: 'santa' }));
vi.mock('../providers/v2-theme-context', () => ({
  useV2Theme: () => themeState,
}));

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  let reduce = initial;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return reduce && query.includes('prefers-reduced-motion');
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  return (next: boolean) => {
    reduce = next;
    for (const listener of listeners) listener();
  };
}

let SnowEffect: typeof import('./SnowEffect').SnowEffect;
let SNOW_STOPPED_KEY: string;

const snow = () => screen.queryByTestId('snow-effect');
const stopButton = () => screen.queryByRole('button', { name: /stop snow/i });

describe('SnowEffect', () => {
  const store = new Map<string, string>();

  beforeEach(async () => {
    // The dismissal fallback is module state: load fresh modules per test.
    vi.resetModules();
    ({ SnowEffect } = await import('./SnowEffect'));
    ({ SNOW_STOPPED_KEY } = await import('./use-snow-dismissal'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 10));
    themeState.theme = 'santa';
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the snow and a stop button without any JavaScript animation loop', () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    render(<SnowEffect />);
    expect(snow()).toHaveAttribute('aria-hidden', 'true');
    expect(stopButton()).toBeInTheDocument();
    expect(raf).not.toHaveBeenCalled();
  });

  it('renders nothing outside the Santa theme', () => {
    themeState.theme = 'standard';
    const { container } = render(<SnowEffect />);
    expect(container).toBeEmptyDOMElement();
  });

  it('follows the reduce-motion setting, including live changes', () => {
    const setReducedMotion = stubMatchMedia(true);
    const { container } = render(<SnowEffect />);
    expect(container).toBeEmptyDOMElement();
    act(() => setReducedMotion(false));
    expect(snow()).toBeInTheDocument();
  });

  it('stops on request and stays stopped for the rest of this year', () => {
    const first = render(<SnowEffect />);
    fireEvent.click(screen.getByRole('button', { name: /stop snow/i }));
    expect(snow()).not.toBeInTheDocument();
    expect(stopButton()).not.toBeInTheDocument();
    expect(store.get(SNOW_STOPPED_KEY)).toBe('2026');
    first.unmount();
    render(<SnowEffect />);
    expect(snow()).not.toBeInTheDocument();
  });

  it('returns the following December', () => {
    store.set(SNOW_STOPPED_KEY, '2025');
    render(<SnowEffect />);
    expect(snow()).toBeInTheDocument();
  });

  it('still stops for this visit when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    render(<SnowEffect />);
    fireEvent.click(screen.getByRole('button', { name: /stop snow/i }));
    expect(snow()).not.toBeInTheDocument();
  });
});
